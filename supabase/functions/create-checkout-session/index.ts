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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
}

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  try {
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401)
    }
    const jwt = authHeader.replace('Bearer ', '').trim()
    if (!jwt) {
      return jsonResponse({ error: 'Empty bearer token' }, 401)
    }
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt)
    if (userError) {
      return jsonResponse(
        { error: `Token verification failed: ${userError.message}` },
        401,
      )
    }
    const user = userData.user
    if (!user) {
      return jsonResponse(
        { error: 'No user resolved from token (probably anon key or expired session)' },
        401,
      )
    }
    if (user.is_anonymous) {
      return jsonResponse(
        { error: 'Anonymous users cannot subscribe. Create a real account first.' },
        401,
      )
    }
    if (!user.email) {
      return jsonResponse({ error: 'User has no email on file' }, 400)
    }

    const body = await req.json()
    const planCode = String(body.planCode || '')
    const successUrl = String(body.successUrl || '')
    const cancelUrl = String(body.cancelUrl || '')
    const priceEnv = PLAN_TO_PRICE_ENV[planCode]
    if (!priceEnv) return jsonResponse({ error: 'Unknown plan code' }, 400)
    const priceId = Deno.env.get(priceEnv)
    if (!priceId) return jsonResponse({ error: `Missing price env: ${priceEnv}` }, 400)

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

    return jsonResponse({ checkoutUrl: session.url }, 200)
  } catch (error) {
    return jsonResponse({ error: String(error) }, 500)
  }
})
