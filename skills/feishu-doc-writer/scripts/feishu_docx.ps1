param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        'get-token',
        'get-wiki-node',
        'create-wiki-docx',
        'get-docx',
        'get-docx-raw',
        'list-docx-blocks',
        'append-paragraphs',
        'clear-docx-root-children',
        'update-wiki-title',
        'delete-drive-file'
    )]
    [string]$Action,

    [string]$ConfigPath,
    [string]$AppId,
    [string]$AppSecret,
    [string]$BaseUri,
    [string]$WikiToken,
    [string]$SpaceId,
    [string]$ParentNodeToken,
    [string]$NodeToken,
    [string]$DocumentId,
    [string]$Title,
    [string]$ContentFile,
    [string[]]$Lines,
    [ValidateSet('doc', 'docx', 'sheet', 'mindnote', 'bitable', 'file', 'slides', 'wiki')]
    [string]$ObjType,
    [int]$PageSize = 100,
    [string]$FileToken,
    [ValidateSet('file', 'docx', 'bitable', 'folder', 'doc', 'sheet', 'mindnote', 'shortcut', 'slides')]
    [string]$FileType = 'docx'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-JsonOutput {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Value
    )

    $Value | ConvertTo-Json -Depth 50
}

function ConvertTo-JsonString {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Object
    )

    return ($Object | ConvertTo-Json -Depth 50 -Compress)
}

function Resolve-ConfigPath {
    if ($ConfigPath) {
        return $ConfigPath
    }

    if ($env:FEISHU_DOC_WRITER_CONFIG) {
        return $env:FEISHU_DOC_WRITER_CONFIG
    }

    return $null
}

function Get-OptionalConfig {
    $resolved = Resolve-ConfigPath
    if (-not $resolved) {
        return $null
    }

    if (-not (Test-Path -LiteralPath $resolved)) {
        throw "Config file not found: $resolved"
    }

    return Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json
}

function Get-ConfigValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,
        [Parameter(Mandatory = $true)]
        [string[]]$Names
    )

    foreach ($name in $Names) {
        $property = $Config.PSObject.Properties[$name]
        if ($property -and $null -ne $property.Value -and $property.Value -ne '') {
            return $property.Value
        }
    }

    return $null
}

function Resolve-Credentials {
    $config = Get-OptionalConfig

    $resolvedAppId = $AppId
    $resolvedAppSecret = $AppSecret
    $resolvedBaseUri = $BaseUri

    if (-not $resolvedAppId -and $env:FEISHU_APP_ID) {
        $resolvedAppId = $env:FEISHU_APP_ID
    }
    if (-not $resolvedAppSecret -and $env:FEISHU_APP_SECRET) {
        $resolvedAppSecret = $env:FEISHU_APP_SECRET
    }
    if (-not $resolvedBaseUri -and $env:FEISHU_BASE_URI) {
        $resolvedBaseUri = $env:FEISHU_BASE_URI
    }

    if ($config) {
        if (-not $resolvedAppId) {
            $resolvedAppId = Get-ConfigValue -Config $config -Names @('appId', 'app_id')
        }

        if (-not $resolvedAppSecret) {
            $resolvedAppSecret = Get-ConfigValue -Config $config -Names @('appSecret', 'app_secret')
        }

        if (-not $resolvedBaseUri) {
            $resolvedBaseUri = Get-ConfigValue -Config $config -Names @('baseUri', 'base_uri')
        }
    }

    if (-not $resolvedAppId -or -not $resolvedAppSecret) {
        throw 'Feishu credentials are missing. Provide -AppId and -AppSecret, set FEISHU_APP_ID and FEISHU_APP_SECRET, or use -ConfigPath / FEISHU_DOC_WRITER_CONFIG.'
    }

    if (-not $resolvedBaseUri) {
        $resolvedBaseUri = 'https://open.feishu.cn'
    }

    return [PSCustomObject]@{
        AppId     = $resolvedAppId
        AppSecret = $resolvedAppSecret
        BaseUri   = $resolvedBaseUri.TrimEnd('/')
    }
}

function Get-TenantAccessToken {
    $credentials = Resolve-Credentials
    $body = ConvertTo-JsonString -Object ([PSCustomObject]@{
            app_id     = $credentials.AppId
            app_secret = $credentials.AppSecret
        })

    $response = Invoke-RestMethod `
        -Method Post `
        -Uri "$($credentials.BaseUri)/open-apis/auth/v3/tenant_access_token/internal" `
        -ContentType 'application/json' `
        -Body $body

    if ($response.code -ne 0) {
        throw "Failed to get tenant access token: code=$($response.code) msg=$($response.msg)"
    }

    return [PSCustomObject]@{
        AccessToken = $response.tenant_access_token
        BaseUri     = $credentials.BaseUri
    }
}

function Invoke-FeishuJsonRequest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Method,
        [Parameter(Mandatory = $true)]
        [string]$Uri,
        [Parameter(Mandatory = $true)]
        [string]$AccessToken,
        [object]$BodyObject
    )

    $headers = @{
        Authorization = "Bearer $AccessToken"
    }

    if ($PSBoundParameters.ContainsKey('BodyObject')) {
        $bodyJson = ConvertTo-JsonString -Object $BodyObject
        return Invoke-RestMethod `
            -Method $Method `
            -Uri $Uri `
            -Headers $headers `
            -ContentType 'application/json; charset=utf-8' `
            -Body $bodyJson
    }

    return Invoke-RestMethod `
        -Method $Method `
        -Uri $Uri `
        -Headers $headers
}

function New-ParagraphBlock {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Line
    )

    return [PSCustomObject]@{
        block_type = 2
        text       = [PSCustomObject]@{
            elements = @(
                [PSCustomObject]@{
                    text_run = [PSCustomObject]@{
                        content = $Line
                    }
                }
            )
        }
    }
}

function Get-ContentLines {
    param(
        [string]$Path,
        [string[]]$InlineLines
    )

    if ($Path) {
        if (-not (Test-Path -LiteralPath $Path)) {
            throw "Content file not found: $Path"
        }

        return @(Get-Content -LiteralPath $Path -Encoding UTF8)
    }

    if ($InlineLines) {
        return @($InlineLines)
    }

    throw 'Provide either -ContentFile or -Lines.'
}

function Get-DocxRootChildren {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DocId,
        [Parameter(Mandatory = $true)]
        [string]$AccessToken,
        [Parameter(Mandatory = $true)]
        [string]$BaseUri
    )

    $response = Invoke-FeishuJsonRequest `
        -Method Get `
        -Uri "$BaseUri/open-apis/docx/v1/documents/$DocId/blocks?page_size=200" `
        -AccessToken $AccessToken

    if ($response.code -ne 0) {
        throw "Failed to list docx blocks: code=$($response.code) msg=$($response.msg)"
    }

    $root = $response.data.items | Where-Object { $_.block_id -eq $DocId } | Select-Object -First 1
    if (-not $root) {
        throw "Root block not found for document $DocId"
    }

    return @($root.children)
}

$session = Get-TenantAccessToken
$accessToken = $session.AccessToken
$baseUri = $session.BaseUri

switch ($Action) {
    'get-token' {
        Write-JsonOutput @{
            tenant_access_token = $accessToken
            base_uri            = $baseUri
        }
        break
    }

    'get-wiki-node' {
        if (-not $WikiToken) {
            throw 'get-wiki-node requires -WikiToken.'
        }

        $uri = "$baseUri/open-apis/wiki/v2/spaces/get_node?token=$WikiToken"
        if ($ObjType) {
            $uri += "&obj_type=$ObjType"
        }

        $response = Invoke-FeishuJsonRequest -Method Get -Uri $uri -AccessToken $accessToken
        Write-JsonOutput $response
        break
    }

    'create-wiki-docx' {
        if (-not $SpaceId -or -not $ParentNodeToken -or -not $Title) {
            throw 'create-wiki-docx requires -SpaceId, -ParentNodeToken, and -Title.'
        }

        $response = Invoke-FeishuJsonRequest `
            -Method Post `
            -Uri "$baseUri/open-apis/wiki/v2/spaces/$SpaceId/nodes" `
            -AccessToken $accessToken `
            -BodyObject ([PSCustomObject]@{
                obj_type          = 'docx'
                parent_node_token = $ParentNodeToken
                node_type         = 'origin'
                title             = $Title
            })

        Write-JsonOutput $response
        break
    }

    'get-docx' {
        if (-not $DocumentId) {
            throw 'get-docx requires -DocumentId.'
        }

        $response = Invoke-FeishuJsonRequest `
            -Method Get `
            -Uri "$baseUri/open-apis/docx/v1/documents/$DocumentId" `
            -AccessToken $accessToken

        Write-JsonOutput $response
        break
    }

    'get-docx-raw' {
        if (-not $DocumentId) {
            throw 'get-docx-raw requires -DocumentId.'
        }

        $response = Invoke-FeishuJsonRequest `
            -Method Get `
            -Uri "$baseUri/open-apis/docx/v1/documents/$DocumentId/raw_content" `
            -AccessToken $accessToken

        Write-JsonOutput $response
        break
    }

    'list-docx-blocks' {
        if (-not $DocumentId) {
            throw 'list-docx-blocks requires -DocumentId.'
        }

        $response = Invoke-FeishuJsonRequest `
            -Method Get `
            -Uri "$baseUri/open-apis/docx/v1/documents/$DocumentId/blocks?page_size=$PageSize" `
            -AccessToken $accessToken

        Write-JsonOutput $response
        break
    }

    'append-paragraphs' {
        if (-not $DocumentId) {
            throw 'append-paragraphs requires -DocumentId.'
        }

        $contentLines = Get-ContentLines -Path $ContentFile -InlineLines $Lines
        if ($contentLines.Count -gt 50) {
            throw 'append-paragraphs accepts at most 50 lines per request. Split the content into batches.'
        }

        $children = @()
        foreach ($line in $contentLines) {
            $children += New-ParagraphBlock -Line $line
        }

        $response = Invoke-FeishuJsonRequest `
            -Method Post `
            -Uri "$baseUri/open-apis/docx/v1/documents/$DocumentId/blocks/$DocumentId/children" `
            -AccessToken $accessToken `
            -BodyObject ([PSCustomObject]@{
                children = @($children)
            })

        Write-JsonOutput $response
        break
    }

    'clear-docx-root-children' {
        if (-not $DocumentId) {
            throw 'clear-docx-root-children requires -DocumentId.'
        }

        $children = Get-DocxRootChildren -DocId $DocumentId -AccessToken $accessToken -BaseUri $baseUri
        if ($children.Count -eq 0) {
            Write-JsonOutput @{
                code    = 0
                msg     = 'success'
                cleared = 0
            }
            break
        }

        $response = Invoke-FeishuJsonRequest `
            -Method Delete `
            -Uri "$baseUri/open-apis/docx/v1/documents/$DocumentId/blocks/$DocumentId/children/batch_delete" `
            -AccessToken $accessToken `
            -BodyObject ([PSCustomObject]@{
                start_index = 0
                end_index   = $children.Count - 1
            })

        Write-JsonOutput $response
        break
    }

    'update-wiki-title' {
        if (-not $SpaceId -or -not $NodeToken -or -not $Title) {
            throw 'update-wiki-title requires -SpaceId, -NodeToken, and -Title.'
        }

        $response = Invoke-FeishuJsonRequest `
            -Method Post `
            -Uri "$baseUri/open-apis/wiki/v2/spaces/$SpaceId/nodes/$NodeToken/update_title" `
            -AccessToken $accessToken `
            -BodyObject ([PSCustomObject]@{
                title = $Title
            })

        Write-JsonOutput $response
        break
    }

    'delete-drive-file' {
        if (-not $FileToken) {
            throw 'delete-drive-file requires -FileToken.'
        }

        $response = Invoke-FeishuJsonRequest `
            -Method Delete `
            -Uri "$baseUri/open-apis/drive/v1/files/${FileToken}?type=$FileType" `
            -AccessToken $accessToken

        Write-JsonOutput $response
        break
    }

    default {
        throw "Unsupported action: $Action"
    }
}
