// Supabase Edge Function: stripe-webhook
// Requires secrets:
// - STRIPE_SECRET_KEY
// - STRIPE_WEBHOOK_SECRET
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY

import Stripe from 'npm:stripe@14.25.0'
import { createClient } from 'npm:@supabase/supabase-js@2.57.0'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
})

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || ''

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
)

const addMonths = (date: Date, months: number) => {
  const next = new Date(date)
  next.setMonth(next.getMonth() + months)
  return next
}

const planDuration = (planCode: string): { months: number } => {
  if (planCode === 'promptpay_yearly_9900') return { months: 12 }
  return { months: 1 }
}

const providerFromPlan = (planCode: string): 'stripe' | 'promptpay' =>
  planCode === 'stripe_monthly_auto_990' ? 'stripe' : 'promptpay'

type BillingMeta = { owner_id: string; plan_code: string }

/**
 * Récupère owner_id + plan_code depuis les metadata Stripe. Sur un renouvellement
 * Stripe (invoice.paid), l'invoice seule n'a pas forcément les metadata, donc on
 * remonte via la Subscription. Pour les PaymentIntents PromptPay one-shot, on
 * remonte via le PaymentIntent.
 */
async function resolveBillingMeta(
  event: Stripe.Event,
): Promise<BillingMeta | null> {
  const pickMeta = (meta: Stripe.Metadata | null | undefined): BillingMeta | null => {
    const ownerId = String(meta?.owner_id || '')
    const planCode = String(meta?.plan_code || '')
    if (!ownerId || !planCode) return null
    return { owner_id: ownerId, plan_code: planCode }
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      return pickMeta(session.metadata)
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const fromInvoice = pickMeta(invoice.metadata)
      if (fromInvoice) return fromInvoice
      const subId = typeof invoice.subscription === 'string' ? invoice.subscription : ''
      if (subId) {
        const sub = await stripe.subscriptions.retrieve(subId)
        return pickMeta(sub.metadata)
      }
      return null
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      return pickMeta(sub.metadata)
    }
    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent
      return pickMeta(pi.metadata)
    }
    default:
      return null
  }
}

async function upsertSubscription(params: {
  ownerId: string
  planCode: string
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete'
  currentPeriodStart: Date
  currentPeriodEnd: Date
  externalCustomerId: string
  externalSubscriptionId: string
  metadataExtra: Record<string, unknown>
}) {
  const provider = providerFromPlan(params.planCode)
  const autoRenew = provider === 'stripe'
  const payload = {
    owner_id: params.ownerId,
    plan_code: params.planCode,
    provider,
    status: params.status,
    current_period_start: params.currentPeriodStart.toISOString(),
    current_period_end: params.currentPeriodEnd.toISOString(),
    auto_renew: autoRenew,
    external_customer_id: params.externalCustomerId || null,
    external_subscription_id: params.externalSubscriptionId || null,
    metadata: params.metadataExtra,
    updated_at: new Date().toISOString(),
  }

  // Upsert par external_subscription_id quand disponible (abonnements Stripe)
  if (params.externalSubscriptionId) {
    const { data: existing } = await supabaseAdmin
      .from('billing_subscriptions')
      .select('id')
      .eq('external_subscription_id', params.externalSubscriptionId)
      .limit(1)
    if (existing && existing.length > 0) {
      await supabaseAdmin
        .from('billing_subscriptions')
        .update(payload)
        .eq('id', existing[0].id)
      return
    }
  }
  // Sinon insertion (paiements one-shot PromptPay)
  await supabaseAdmin.from('billing_subscriptions').insert(payload)
}

Deno.serve(async (req) => {
  try {
    const payload = await req.text()
    const signature = req.headers.get('stripe-signature') || ''
    const event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecret,
    )

    const meta = await resolveBillingMeta(event)

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (!meta) break
        const now = new Date()
        const { months } = planDuration(meta.plan_code)
        // Pour les abonnements Stripe récurrents, on utilise les dates réelles
        // de la subscription ; sinon (PromptPay one-shot), on calcule à partir de now.
        let periodStart = now
        let periodEnd = addMonths(now, months)
        let subscriptionId = ''
        if (typeof session.subscription === 'string') {
          subscriptionId = session.subscription
          const sub = await stripe.subscriptions.retrieve(subscriptionId)
          periodStart = new Date(sub.current_period_start * 1000)
          periodEnd = new Date(sub.current_period_end * 1000)
        }
        await upsertSubscription({
          ownerId: meta.owner_id,
          planCode: meta.plan_code,
          status: 'active',
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          externalCustomerId: typeof session.customer === 'string' ? session.customer : '',
          externalSubscriptionId: subscriptionId,
          metadataExtra: { checkout_session_id: session.id },
        })
        await supabaseAdmin
          .from('billing_payments')
          .update({ status: 'succeeded', paid_at: now.toISOString() })
          .eq('external_payment_id', session.id)
        break
      }

      case 'invoice.paid': {
        if (!meta) break
        const invoice = event.data.object as Stripe.Invoice
        const subId = typeof invoice.subscription === 'string' ? invoice.subscription : ''
        if (!subId) break
        const sub = await stripe.subscriptions.retrieve(subId)
        await upsertSubscription({
          ownerId: meta.owner_id,
          planCode: meta.plan_code,
          status: 'active',
          currentPeriodStart: new Date(sub.current_period_start * 1000),
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          externalCustomerId: typeof invoice.customer === 'string' ? invoice.customer : '',
          externalSubscriptionId: subId,
          metadataExtra: { last_invoice_id: invoice.id },
        })
        break
      }

      case 'invoice.payment_failed': {
        if (!meta) break
        const invoice = event.data.object as Stripe.Invoice
        const subId = typeof invoice.subscription === 'string' ? invoice.subscription : ''
        if (!subId) break
        await supabaseAdmin
          .from('billing_subscriptions')
          .update({ status: 'past_due', updated_at: new Date().toISOString() })
          .eq('external_subscription_id', subId)
        break
      }

      case 'customer.subscription.updated': {
        if (!meta) break
        const sub = event.data.object as Stripe.Subscription
        const mappedStatus: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' =
          sub.status === 'active'
            ? 'active'
            : sub.status === 'trialing'
              ? 'trialing'
              : sub.status === 'past_due'
                ? 'past_due'
                : sub.status === 'canceled' || sub.status === 'unpaid'
                  ? 'canceled'
                  : 'incomplete'
        await upsertSubscription({
          ownerId: meta.owner_id,
          planCode: meta.plan_code,
          status: mappedStatus,
          currentPeriodStart: new Date(sub.current_period_start * 1000),
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          externalCustomerId: typeof sub.customer === 'string' ? sub.customer : '',
          externalSubscriptionId: sub.id,
          metadataExtra: { cancel_at_period_end: sub.cancel_at_period_end },
        })
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await supabaseAdmin
          .from('billing_subscriptions')
          .update({
            status: 'canceled',
            auto_renew: false,
            updated_at: new Date().toISOString(),
          })
          .eq('external_subscription_id', sub.id)
        break
      }

      case 'payment_intent.succeeded': {
        // Cas PromptPay one-shot (monthly / yearly) : checkout.session.completed
        // a déjà posé l'abonnement ; on se contente de confirmer le payment ici.
        const pi = event.data.object as Stripe.PaymentIntent
        await supabaseAdmin
          .from('billing_payments')
          .update({ status: 'succeeded', paid_at: new Date().toISOString() })
          .eq('external_payment_id', pi.id)
        break
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent
        await supabaseAdmin
          .from('billing_payments')
          .update({ status: 'failed' })
          .eq('external_payment_id', pi.id)
        break
      }

      default:
        break
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 400 })
  }
})
