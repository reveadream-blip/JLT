// Supabase Edge Function: create-checkout-session
// Requires secrets:
// - STRIPE_SECRET_KEY
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - STRIPE_PRICE_STRIPE_MONTHLY_AUTO_990
// - STRIPE_PRICE_PROMPTPAY_MONTHLY_990
// - STRIPE_PRICE_PROMPTPAY_YEARLY_9900

import Stripe from 'npm:stripe@14.25.0'
import { createClient } from 'npm:@supabase/supabase-js@2.57.0'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
})

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
)

const PLAN_TO_PRICE_ENV: Record<string, string> = {
  stripe_monthly_auto_990: 'STRIPE_PRICE_STRIPE_MONTHLY_AUTO_990',
  promptpay_monthly_990: 'STRIPE_PRICE_PROMPTPAY_MONTHLY_990',
  promptpay_yearly_9900: 'STRIPE_PRICE_PROMPTPAY_YEARLY_9900',
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace('Bearer ', '')
    const { data: userData } = await supabaseAdmin.auth.getUser(jwt)
    const user = userData.user
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

    const body = await req.json()
    const planCode = String(body.planCode || '')
    const successUrl = String(body.successUrl || '')
    const cancelUrl = String(body.cancelUrl || '')
    const priceEnv = PLAN_TO_PRICE_ENV[planCode]
    if (!priceEnv) return new Response(JSON.stringify({ error: 'Unknown plan code' }), { status: 400 })
    const priceId = Deno.env.get(priceEnv)
    if (!priceId) return new Response(JSON.stringify({ error: `Missing price env: ${priceEnv}` }), { status: 400 })

    const isStripeRecurring = planCode === 'stripe_monthly_auto_990'
    const sharedMetadata = {
      owner_id: user.id,
      plan_code: planCode,
    }
    const session = await stripe.checkout.sessions.create({
      mode: isStripeRecurring ? 'subscription' : 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: user.email,
      metadata: sharedMetadata,
      // Pour les abonnements Stripe récurrents, on propage aussi le metadata
      // vers l'objet Subscription pour retrouver l'owner_id lors des renouvellements.
      subscription_data: isStripeRecurring
        ? { metadata: sharedMetadata }
        : undefined,
      // Pour les paiements PromptPay (one-shot), on attache le metadata au PaymentIntent.
      payment_intent_data: !isStripeRecurring
        ? { metadata: sharedMetadata }
        : undefined,
      payment_method_types: isStripeRecurring ? ['card'] : ['promptpay', 'card'],
    })

    await supabaseAdmin.from('billing_payments').insert({
      owner_id: user.id,
      plan_code: planCode,
      provider: isStripeRecurring ? 'stripe' : 'promptpay',
      amount_thb: 0,
      status: 'pending',
      external_payment_id: session.id,
      checkout_url: session.url,
      metadata: { checkout_mode: session.mode },
    })

    return new Response(JSON.stringify({ checkoutUrl: session.url }), { status: 200 })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 })
  }
})
