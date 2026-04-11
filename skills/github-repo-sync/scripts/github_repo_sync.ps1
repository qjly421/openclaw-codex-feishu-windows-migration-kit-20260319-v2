param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        'inspect-local-setup',
        'gh-auth-status',
        'gh-user',
        'show-ssh-public-key',
        'upload-ssh-key',
        'repo-status',
        'git-remote',
        'set-ssh-remote',
        'test-ssh',
        'pull-current-branch',
        'push-current-branch'
    )]
    [string]$Action,

    [string]$GitPath = $(if ($env:GITHUB_SKILL_GIT_PATH) { $env:GITHUB_SKILL_GIT_PATH } else { '' }),
    [string]$GhPath = $(if ($env:GITHUB_SKILL_GH_PATH) { $env:GITHUB_SKILL_GH_PATH } else { '' }),
    [string]$RepoPath = $(if ($env:GITHUB_SKILL_REPO_PATH) { $env:GITHUB_SKILL_REPO_PATH } else { '' }),
    [string]$RemoteName = 'origin',
    [string]$Branch,
    [string]$RemoteSshUrl,
    [string]$SshPublicKeyPath = $(if ($env:GITHUB_SKILL_SSH_PUB_PATH) { $env:GITHUB_SKILL_SSH_PUB_PATH } else { (Join-Path -Path (Join-Path -Path $HOME -ChildPath '.ssh') -ChildPath 'id_ed25519.pub') }),
    [string]$SshPrivateKeyPath = $(if ($env:GITHUB_SKILL_SSH_KEY_PATH) { $env:GITHUB_SKILL_SSH_KEY_PATH } else { (Join-Path -Path (Join-Path -Path $HOME -ChildPath '.ssh') -ChildPath 'id_ed25519') }),
    [string]$SshKeyTitle = 'codex-github-key',
    [string]$SshConfigPath = $(if ($env:GITHUB_SKILL_SSH_CONFIG_PATH) { $env:GITHUB_SKILL_SSH_CONFIG_PATH } else { (Join-Path -Path (Join-Path -Path $HOME -ChildPath '.ssh') -ChildPath 'config') })
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

function Resolve-ToolPath {
    param(
        [string]$RequestedPath,
        [string]$CommandName,
        [string[]]$FallbackPaths
    )

    if ($RequestedPath -and (Test-Path -LiteralPath $RequestedPath)) {
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    if ($CommandName) {
        try {
            return (Get-Command $CommandName -ErrorAction Stop).Source
        } catch {
        }
    }

    foreach ($candidate in @($FallbackPaths)) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    throw "Unable to resolve tool path for $CommandName"
}

function Get-GitFallbackPaths {
    return @(
        (Join-Path -Path $HOME -ChildPath 'tools\git\mingit\cmd\git.exe'),
        $(if ($env:ProgramFiles) { Join-Path -Path $env:ProgramFiles -ChildPath 'Git\cmd\git.exe' }),
        $(if ($env:ProgramFiles) { Join-Path -Path $env:ProgramFiles -ChildPath 'Git\bin\git.exe' }),
        $(if ($env:LocalAppData) { Join-Path -Path $env:LocalAppData -ChildPath 'Programs\Git\cmd\git.exe' })
    )
}

function Get-GhFallbackPaths {
    return @(
        (Join-Path -Path $HOME -ChildPath 'tools\gh\tmp\bin\gh.exe'),
        $(if ($env:ProgramFiles) { Join-Path -Path $env:ProgramFiles -ChildPath 'GitHub CLI\gh.exe' }),
        $(if ($env:LocalAppData) { Join-Path -Path $env:LocalAppData -ChildPath 'Programs\GitHub CLI\gh.exe' })
    )
}

function Resolve-GitExecutable {
    return Resolve-ToolPath -RequestedPath $GitPath -CommandName 'git' -FallbackPaths (Get-GitFallbackPaths)
}

function Resolve-GhExecutable {
    return Resolve-ToolPath -RequestedPath $GhPath -CommandName 'gh' -FallbackPaths (Get-GhFallbackPaths)
}

function Invoke-ExternalText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $quotedArguments = foreach ($argument in $Arguments) {
        if ($null -eq $argument -or $argument -eq '') {
            '""'
            continue
        }

        if ($argument -notmatch '[\s"]') {
            $argument
            continue
        }

        $escaped = $argument -replace '(\\*)"', '$1$1\"'
        $escaped = $escaped -replace '(\\+)$', '$1$1'
        '"' + $escaped + '"'
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = (($quotedArguments | Where-Object { $null -ne $_ }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo

    $null = $process.Start()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    $combinedOutput = @()
    if ($stdout) {
        $combinedOutput += $stdout.TrimEnd()
    }

    if ($stderr) {
        $combinedOutput += $stderr.TrimEnd()
    }

    [PSCustomObject]@{
        exit_code = $process.ExitCode
        output    = (($combinedOutput -join [Environment]::NewLine).Trim())
    }
}

function Get-ResolvedRepoPath {
    param([string]$Path)

    $candidatePath = if ($Path) { $Path } else { (Get-Location).Path }
    if (-not (Test-Path -LiteralPath $candidatePath)) {
        throw "Repo path not found: $candidatePath"
    }

    return (Resolve-Path -LiteralPath $candidatePath).Path
}

function Get-CurrentBranchName {
    param(
        [string]$GitExe,
        [string]$RepoRoot
    )

    $result = Invoke-ExternalText -FilePath $GitExe -Arguments @('-C', $RepoRoot, 'branch', '--show-current')
    if ($result.exit_code -eq 0 -and $result.output) {
        return $result.output.Trim()
    }

    $fallback = Invoke-ExternalText -FilePath $GitExe -Arguments @('-C', $RepoRoot, 'rev-parse', '--abbrev-ref', 'HEAD')
    if ($fallback.exit_code -ne 0) {
        throw "Failed to resolve current branch: $($fallback.output)"
    }

    return $fallback.output.Trim()
}

function Get-RemoteUrl {
    param(
        [string]$GitExe,
        [string]$RepoRoot,
        [string]$Remote
    )

    $result = Invoke-ExternalText -FilePath $GitExe -Arguments @('-C', $RepoRoot, 'remote', 'get-url', $Remote)
    if ($result.exit_code -ne 0) {
        throw "Failed to read remote URL: $($result.output)"
    }

    return $result.output.Trim()
}

function Convert-HttpsRemoteToSsh {
    param([string]$Url)

    if ($Url -match '^git@github\.com:') {
        return $Url
    }

    if ($Url -match '^https://github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$') {
        return "git@github.com:$($Matches[1])/$($Matches[2]).git"
    }

    throw "Remote URL is not a supported GitHub HTTPS remote: $Url"
}

function Get-SshPublicKeyInfo {
    param([string]$PublicKeyPath)

    if (-not (Test-Path -LiteralPath $PublicKeyPath)) {
        throw "SSH public key not found: $PublicKeyPath"
    }

    $sshKeygen = Resolve-ToolPath -RequestedPath '' -CommandName 'ssh-keygen'
    $fingerprintResult = Invoke-ExternalText -FilePath $sshKeygen -Arguments @('-lf', $PublicKeyPath)
    if ($fingerprintResult.exit_code -ne 0) {
        throw "Failed to inspect SSH key fingerprint: $($fingerprintResult.output)"
    }

    [PSCustomObject]@{
        public_key_path = (Resolve-Path -LiteralPath $PublicKeyPath).Path
        public_key      = (Get-Content -LiteralPath $PublicKeyPath -Raw).Trim()
        fingerprint     = $fingerprintResult.output.Trim()
    }
}

switch ($Action) {
    'inspect-local-setup' {
        $resolvedGit = Resolve-GitExecutable
        $resolvedGh = Resolve-GhExecutable
        $resolvedRepo = Get-ResolvedRepoPath -Path $RepoPath
        $sshInfo = Get-SshPublicKeyInfo -PublicKeyPath $SshPublicKeyPath
        $remoteUrl = Get-RemoteUrl -GitExe $resolvedGit -RepoRoot $resolvedRepo -Remote $RemoteName
        $branchName = Get-CurrentBranchName -GitExe $resolvedGit -RepoRoot $resolvedRepo

        Write-JsonOutput @{
            git_path           = $resolvedGit
            gh_path            = $resolvedGh
            repo_path          = $resolvedRepo
            remote_name        = $RemoteName
            remote_url         = $remoteUrl
            branch             = $branchName
            ssh_public_key     = $sshInfo.public_key_path
            ssh_fingerprint    = $sshInfo.fingerprint
            ssh_private_key    = $(if (Test-Path -LiteralPath $SshPrivateKeyPath) { (Resolve-Path -LiteralPath $SshPrivateKeyPath).Path } else { $SshPrivateKeyPath })
            ssh_config_path    = $(if (Test-Path -LiteralPath $SshConfigPath) { (Resolve-Path -LiteralPath $SshConfigPath).Path } else { $SshConfigPath })
        }
        break
    }

    'gh-auth-status' {
        $resolvedGh = Resolve-GhExecutable
        $result = Invoke-ExternalText -FilePath $resolvedGh -Arguments @('auth', 'status')
        Write-JsonOutput $result
        break
    }

    'gh-user' {
        $resolvedGh = Resolve-GhExecutable
        $result = Invoke-ExternalText -FilePath $resolvedGh -Arguments @('api', 'user')
        if ($result.exit_code -ne 0) {
            Write-JsonOutput $result
            break
        }

        try {
            $parsed = $result.output | ConvertFrom-Json
            Write-JsonOutput $parsed
        } catch {
            Write-JsonOutput $result
        }
        break
    }

    'show-ssh-public-key' {
        $sshInfo = Get-SshPublicKeyInfo -PublicKeyPath $SshPublicKeyPath
        Write-JsonOutput $sshInfo
        break
    }

    'upload-ssh-key' {
        $resolvedGh = Resolve-GhExecutable
        $sshInfo = Get-SshPublicKeyInfo -PublicKeyPath $SshPublicKeyPath
        $result = Invoke-ExternalText -FilePath $resolvedGh -Arguments @('ssh-key', 'add', $sshInfo.public_key_path, '--title', $SshKeyTitle)
        Write-JsonOutput @{
            title           = $SshKeyTitle
            public_key_path = $sshInfo.public_key_path
            fingerprint     = $sshInfo.fingerprint
            exit_code       = $result.exit_code
            output          = $result.output
        }
        break
    }

    'repo-status' {
        $resolvedGit = Resolve-GitExecutable
        $resolvedRepo = Get-ResolvedRepoPath -Path $RepoPath
        $branchName = Get-CurrentBranchName -GitExe $resolvedGit -RepoRoot $resolvedRepo
        $short = Invoke-ExternalText -FilePath $resolvedGit -Arguments @('-C', $resolvedRepo, 'status', '--short')
        $branchStatus = Invoke-ExternalText -FilePath $resolvedGit -Arguments @('-C', $resolvedRepo, 'status', '--short', '--branch')
        Write-JsonOutput @{
            branch              = $branchName
            status_short_exit   = $short.exit_code
            status_short        = $short.output
            status_branch_exit  = $branchStatus.exit_code
            status_branch       = $branchStatus.output
        }
        break
    }

    'git-remote' {
        $resolvedGit = Resolve-GitExecutable
        $resolvedRepo = Get-ResolvedRepoPath -Path $RepoPath
        $result = Invoke-ExternalText -FilePath $resolvedGit -Arguments @('-C', $resolvedRepo, 'remote', '-v')
        Write-JsonOutput $result
        break
    }

    'set-ssh-remote' {
        $resolvedGit = Resolve-GitExecutable
        $resolvedRepo = Get-ResolvedRepoPath -Path $RepoPath
        $oldUrl = Get-RemoteUrl -GitExe $resolvedGit -RepoRoot $resolvedRepo -Remote $RemoteName
        $newUrl = if ($RemoteSshUrl) { $RemoteSshUrl } else { Convert-HttpsRemoteToSsh -Url $oldUrl }
        $result = Invoke-ExternalText -FilePath $resolvedGit -Arguments @('-C', $resolvedRepo, 'remote', 'set-url', $RemoteName, $newUrl)
        $updatedUrl = Get-RemoteUrl -GitExe $resolvedGit -RepoRoot $resolvedRepo -Remote $RemoteName

        Write-JsonOutput @{
            remote_name = $RemoteName
            old_url     = $oldUrl
            new_url     = $updatedUrl
            exit_code   = $result.exit_code
            output      = $result.output
        }
        break
    }

    'test-ssh' {
        $sshExe = Resolve-ToolPath -RequestedPath '' -CommandName 'ssh'
        $result = Invoke-ExternalText -FilePath $sshExe -Arguments @('-o', 'StrictHostKeyChecking=accept-new', '-T', 'git@github.com')
        Write-JsonOutput @{
            exit_code = $result.exit_code
            output    = $result.output
        }
        break
    }

    'pull-current-branch' {
        $resolvedGit = Resolve-GitExecutable
        $resolvedRepo = Get-ResolvedRepoPath -Path $RepoPath
        $branchName = if ($Branch) { $Branch } else { Get-CurrentBranchName -GitExe $resolvedGit -RepoRoot $resolvedRepo }
        $result = Invoke-ExternalText -FilePath $resolvedGit -Arguments @('-C', $resolvedRepo, 'pull', '--ff-only', $RemoteName, $branchName)
        Write-JsonOutput @{
            remote_name = $RemoteName
            branch      = $branchName
            exit_code   = $result.exit_code
            output      = $result.output
        }
        break
    }

    'push-current-branch' {
        $resolvedGit = Resolve-GitExecutable
        $resolvedRepo = Get-ResolvedRepoPath -Path $RepoPath
        $branchName = if ($Branch) { $Branch } else { Get-CurrentBranchName -GitExe $resolvedGit -RepoRoot $resolvedRepo }
        $result = Invoke-ExternalText -FilePath $resolvedGit -Arguments @('-C', $resolvedRepo, 'push', $RemoteName, $branchName)
        Write-JsonOutput @{
            remote_name = $RemoteName
            branch      = $branchName
            exit_code   = $result.exit_code
            output      = $result.output
        }
        break
    }
}
