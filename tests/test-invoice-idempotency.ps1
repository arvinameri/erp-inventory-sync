param(
  [string]$BaseUrl = "http://localhost:3000",
  [Parameter(Mandatory = $true)]
  [string]$OrderId,
  [switch]$DryRun
)

$checkUrl = "$BaseUrl/invoice/check/$OrderId"
$singleUrl = "$BaseUrl/invoice/single"
$debugUrl = "$BaseUrl/invoice/debug-order/$OrderId"

function Post-Json($url, $bodyObj) {
  $json = $bodyObj | ConvertTo-Json -Depth 10
  return Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json" -Body $json
}

function Read-ErrorMessage($err) {
  if ($err.ErrorDetails -and $err.ErrorDetails.Message) {
    return $err.ErrorDetails.Message
  }
  return $err.Exception.Message
}

Write-Host ""
Write-Host "1) Debug order"
try {
  $debug = Invoke-RestMethod -Uri $debugUrl -Method Get
  $debug | ConvertTo-Json -Depth 8
} catch {
  Write-Error ("debug-order failed: " + (Read-ErrorMessage $_))
  exit 1
}

Write-Host ""
Write-Host "2) Check before"
try {
  $before = Invoke-RestMethod -Uri $checkUrl -Method Get
  $before | ConvertTo-Json -Depth 8
} catch {
  Write-Error ("check before failed: " + (Read-ErrorMessage $_))
  exit 1
}

Write-Host ""
Write-Host "3) First run"
try {
  $run1 = Post-Json $singleUrl @{ orderId = $OrderId; dryRun = [bool]$DryRun }
  $run1 | ConvertTo-Json -Depth 10
} catch {
  Write-Error ("first run failed: " + (Read-ErrorMessage $_))
  exit 1
}

Write-Host ""
Write-Host "4) Second run"
try {
  $run2 = Post-Json $singleUrl @{ orderId = $OrderId; dryRun = [bool]$DryRun }
  $run2 | ConvertTo-Json -Depth 10
} catch {
  Write-Error ("second run failed: " + (Read-ErrorMessage $_))
  exit 1
}

Write-Host ""
Write-Host "5) Check after"
try {
  $after = Invoke-RestMethod -Uri $checkUrl -Method Get
  $after | ConvertTo-Json -Depth 8
} catch {
  Write-Error ("check after failed: " + (Read-ErrorMessage $_))
  exit 1
}

Write-Host ""
Write-Host "6) Summary"

$action1 = $run1.action
if (-not $action1 -and $run1.result) { $action1 = $run1.result.action }

$action2 = $run2.action
if (-not $action2 -and $run2.result) { $action2 = $run2.result.action }

$invoiceNumber = $null
if ($after.invoice) {
  $invoiceNumber = $after.invoice.Number
  if (-not $invoiceNumber) { $invoiceNumber = $after.invoice.number }
}

[pscustomobject]@{
  OrderId = $OrderId
  FirstRunAction = $action1
  SecondRunAction = $action2
  InvoicedAfter = $after.invoiced
  InvoiceNumber = $invoiceNumber
} | Format-List