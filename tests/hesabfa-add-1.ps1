$ErrorActionPreference = "Stop"

# ===== تنظیمات =====
$apiUrl = "https://api.hesabfa.com/api/warehouse/enter"

$apiKey = "oNatfsiwo3ZQbgq2FgIam0i5idajsZQp"
$loginToken = "131497e45c951d35bff7b5b2a7dcad220fef674aeb093a35e584f1f0cba2966199ae1cedd09d94dce7f3cbca6c4b7025"

# ===== بدنه درخواست =====
$body = @{
    apiKey     = $apiKey
    loginToken = $loginToken

    # سند ورود به انبار (رسید)
    document   = @{
        WarehouseCode = 11
        Description   = "Test +1 for syncing"
        Items = @(
            @{
                ItemCode  = "001048"
                Quantity  = 1
                UnitPrice = 0
            }
        )
    }
} | ConvertTo-Json -Depth 10

# ===== ارسال درخواست =====
$response = Invoke-RestMethod `
    -Method Post `
    -Uri $apiUrl `
    -ContentType "application/json" `
    -Body $body

$response | ConvertTo-Json -Depth 10
