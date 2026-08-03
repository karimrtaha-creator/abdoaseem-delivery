# Proves create-order ignores any client-supplied price and always uses
# the server-side menu_items/combo_offers price instead.
#
# Item id 1 = small kosahri box ("olbet koshary soghayara"), real catalog
# price = 30 EGP (see supabase/seed.sql).
# This script asks for it at a forged price of 1 EGP and a forged
# unit_price/total_price of 1 too, then reads back what actually landed in
# order_items to confirm the forged values were ignored.

$SUPA_URL = "https://jugaubxwmlszkfqlnzul.supabase.co"
$ANON_KEY = "sb_publishable_M1up5O_HXxRl4sndK8nESQ__2yMOfnD"

$loginResp = Invoke-RestMethod -Uri "$SUPA_URL/auth/v1/token?grant_type=password" -Method POST `
  -Headers @{ "apikey" = $ANON_KEY; "Content-Type" = "application/json" } `
  -Body '{"email":"01077778888@abdoaseem.internal","password":"CallCenter123!"}'
$token = $loginResp.access_token

$body = @{
  customer_phone = "01098765432"
  customer_name  = "price tamper test"
  address        = @{ area = "test area" }
  branch_id      = 1
  items          = @(
    @{
      menu_item_id = 1
      quantity     = 2
      # None of these three fields exist in create-order's CartItem type -
      # if the server trusted the body at all, one of them would win.
      price        = 1
      unit_price   = 1
      total_price  = 2
    }
  )
  payment_method = "cash"
} | ConvertTo-Json -Depth 5

Write-Output "--- calling create-order with a forged price ---"
$orderResp = Invoke-RestMethod -Uri "$SUPA_URL/functions/v1/create-order" -Method POST `
  -Headers @{ "Authorization" = "Bearer $token"; "apikey" = $ANON_KEY; "Content-Type" = "application/json" } `
  -Body $body
$orderResp | ConvertTo-Json -Depth 5

$orderId = $orderResp.order_id
Write-Output "`n--- reading back order_items for order $orderId (service key, bypasses RLS) ---"
$SERVICE_KEY = "sb_secret_8fVoublGPmIpsRzdzu9Lyg_TUGP18_s"
$items = Invoke-RestMethod -Uri "$SUPA_URL/rest/v1/order_items?order_id=eq.$orderId&select=*" `
  -Headers @{ "apikey" = $SERVICE_KEY; "Authorization" = "Bearer $SERVICE_KEY" }
$items | ConvertTo-Json -Depth 5

$actualPrice = $items[0].unit_price
if ($actualPrice -eq 30) {
  Write-Output "`nPASS: unit_price = $actualPrice (real catalog price) - forged price (1) was ignored."
} else {
  Write-Output "`nFAIL: unit_price = $actualPrice - expected 30. Forged price may have leaked through."
}
