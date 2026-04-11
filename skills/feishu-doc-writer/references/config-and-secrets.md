# Config And Secrets

The public skill must never contain real Feishu credentials.

## Supported credential inputs

Use one of these:

1. `-AppId` and `-AppSecret`
2. environment variables:
   - `FEISHU_APP_ID`
   - `FEISHU_APP_SECRET`
3. `-ConfigPath`
4. environment variable:
   - `FEISHU_DOC_WRITER_CONFIG`

## Supported config schema

The local config file may contain either naming style:

- `appId` and `appSecret`
- `app_id` and `app_secret`

Optional fields:

- `baseUri`

## What belongs outside the public repo

- real `appId`
- real `appSecret`
- real tenant-specific endpoints if they are sensitive
- machine-local absolute paths
- internal allowlists for specific people, groups, spaces, or nodes

Keep those values in a local config file, environment variables, a private companion repo, or a restricted Feishu cloud document.
