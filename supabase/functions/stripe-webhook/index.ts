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

Deno.serve(async (req) => {
  try {
    const payload = await req.text()
    const signature = req.headers.get('stripe-signature') || ''
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret)

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'invoice.paid' ||
      event.type === 'payment_intent.succeeded'
    ) {
      const session = event.data.object as Stripe.Checkout.Session
      const ownerId = String(session.metadata?.owner_id || '')
      const planCode = String(session.metadata?.plan_code || '')
      if (ownerId && planCode) {
        const now = new Date()
        const isYearly = planCode === 'promptpay_yearly_9900'
        const end = isYearly ? addMonths(now, 12) : addMonths(now, 1)
        await supabaseAdmin.from('billing_subscriptions').insert({
          owner_id: ownerId,
          plan_code: planCode,
          provider: planCode === 'stripe_monthly_auto_990' ? 'stripe' : 'promptpay',
          status: 'active',
          current_period_start: now.toISOString(),
          current_period_end: end.toISOString(),
          auto_renew: planCode === 'stripe_monthly_auto_990',
          external_customer_id: String(session.customer || ''),
          external_subscription_id: String(session.subscription || ''),
          metadata: { checkout_session_id: session.id },
        })
        await supabaseAdmin
          .from('billing_payments')
          .update({ status: 'succeeded', paid_at: now.toISOString() })
          .eq('external_payment_id', session.id)
      }
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 400 })
  }
})
