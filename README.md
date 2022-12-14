![CI](https://github.com/nearform/slack-channel-github-team-sync/actions/workflows/ci.yml/badge.svg?event=push)
![CD](https://github.com/nearform/slack-channel-github-team-sync/actions/workflows/cd.yml/badge.svg?event=push)

# slack-channel-github-team-sync

The main purpose of this project is to mirror members of a Slack channel with a
GitHub team. If a slack user joins a Slack channel that this app is listening
to, they will automatically be associated with the corresponding GitHub team.

As an additional feature, information can also be synced with a Google
Spreadsheet.

We have three lambdas in this repository:
- Emitter: Listens to Slack events, filters only events from configured
channels, appends the user's profile data and sends them to SQS.
- Receiver: Is triggered by SQS and handles the events.
- Sync: Runs on a cron-based schedule and checks that all members of the
configured Slack channels are added or removed from the corresponding GitHub
team.

The application accepts configurations of as many `githubTeam` and
`slackChannel` pairs as needed.

The APP_CONFIG variable example below shows how to configure these pairs.
```json
[
  { 
    "slackChannel": "Slack channel ID", 
    "githubTeam": "github team name" 
  }
]
```

## Workflow

![github_team](https://user-images.githubusercontent.com/100228920/160125285-d546cbda-2f79-4eee-b4f0-6360ce95c9fb.png)

## Requirements

- A [GitHub App](https://docs.github.com/en/developers/apps/getting-started-with-apps/about-apps)
configured as below.
- A [Slack App](https://api.slack.com/start/building) configured as below.
- AWS credentials and permissions to create Lambda Functions, API Gateway, SSM,
SQS and EventBridge Resources.
- **If desired**, A [Spreadsheet App](https://developers.google.com/sheets/api/reference/rest)
configured as below.

### Slack App Configuration

This lambda integration listens to the following slack events:

- member_joined_channel: validate user and channel and it to GitHub team
- member_left_channel: validate channel and remove the user from the GitHub team
- user_change: validate the user and channel members and then remove it from the
GitHub team

The following Slack API endpoints are requested:

- [users.profile.get:](https://api.slack.com/methods/users.profile.get):
`GET https://slack.com/api/users.profile.get`
- [chat.postMessage](https://api.slack.com/methods/chat.postMessage):
`POST https://slack.com/api/chat.postMessage`
- [conversations.members](https://slack.com/api/conversations.members):
`GET https://slack.com/api/conversations.members`

For all the above to work, the following [permission scopes](https://api.slack.com/scopes):

- `channels:` or `groups:` or `im:` or `mpim:` scopes corresponding to the
conversation is the channel selected.
- `chat:write`
- `users.profile:read`

### GitHub App Configuration

The following GitHub Rest API endpoints are requested:

- [Add or update team membership for a user](https://docs.github.com/en/rest/reference/teams#add-or-update-team-membership-for-a-user):
`PUT /orgs/${org}/teams/${teamSlug}/memberships/${username}`
- [Remove team membership for a user](https://docs.github.com/en/rest/reference/teams#remove-team-membership-for-a-user):
`DELETE /orgs/${org}/teams/${teamSlug}/memberships/${username}`
- [List team members](https://docs.github.com/en/rest/reference/teams#list-team-members):
`GET /orgs/${org}/teams/${teamSlug}/members`
- [List organization members](https://docs.github.com/en/rest/reference/orgs#list-organization-members):
`GET /orgs/${org}/members`
- [Check organization membership for a user](https://docs.github.com/en/rest/reference/orgs#check-organization-membership-for-a-user):
`GET /orgs/{org}/members/{username}`

### Spreadsheet App Configuration

Some information is required to set the app up:

- A valid
[Google Cloud project](https://developers.google.com/workspace/guides/create-project)
- A valid
[Service Account Key](https://developers.google.com/workspace/guides/create-credentials#service-account)
  - The Service Account to which the key belongs should have write access to
    the spreadsheet. That can be done by sharing the sheet with the service
    account's email address and making it an `Editor`
- The spreadsheet ID
- A data range in the
[A1](https://developers.google.com/sheets/api/guides/concepts) notation
- A valid
[locale](https://ftpdocs.broadcom.com/cadocs/0/CA%20RiskMinder%203%201-ENU/Bookshelf_Files/HTML/idocs/2112038.html)
- A valid
[timezone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)

The currently supoprted spreadsheet format is equivalent to the following csv
data:

```csv
Name,Profile,Start,End,New hire,Github Username
John Appleseed,BE,01/01/2021,05/03/2021,,johnappleseed
James Smith,FE,01/02/2021,05/02/2021,X,jamessmith
```

The most relevant part of the structure is:

- `Start` and `End` dates should be in the 3rd and 4th columns
- `New hire` should be in the 5th column
- `Github Username` should be in the 6th column

The current version of the app requires exactly 6 columns.

## Environment variables (CDK)

These variables are needed to create the environment at AWS.

- ENVIRONMENT: Required to create a cloud formation stack (the cloud formation name is dynamic to create multiple environments in one AWS account and region).
- SLACK_CONFIG:
```json
{ 
  "signingSecret": "signing secret from slack app", 
  "botToken": "bot token from slack app", 
  "githubUrlField": "use Slack get profile API to check your github field ID" 
}
```
- GITHUB_CONFIG:
```json
{ 
  "organizationSlug": "name of the organization", 
  "appId": "github app ID", 
  "privateKey": "private key from github app" 
}
```
- APP_CONFIG:
```json
[
  { 
    "slackChannel": "Slack channel ID", 
    "githubTeam": "github team name (just the team name, not its fully qualified version)"
  }
]
```
- SHEET_CONFIG:
```json
[{
  "serviceAccountKey": {
    "type": "service_account",
    "project_id": "project_id",
    "private_key_id": "private_key_id",
    "private_key": "private_key",
    "client_email": "service-account@project_id.iam.gserviceaccount.com",
    "client_id": "client_id",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/service-account%40project_id.iam.gserviceaccount.com"
  },
  "spreadsheetId": "spreadsheet_id",
  "slackChannel": "slack_channel_id",
  "dataRange": "data!A1:F",
  "locale": "en-US",
  "timezone": "Europe/Dublin"
}]
```

## Environment variables (APP)

These variables are created by the CDK based on AWS resources, these SSM_*
variables are used to get values from the AWS SSM, and the SQS_QUEUE_URL is used
by the lambda emitter to configure the SQS integration.

- SSM_SLACK_PARAMETER: SSM parameter name, created by CDK
- SSM_GITHUB_PARAMETER: SSM parameter name, created by CDK
- SSM_CONFIG_PARAMETER: SSM parameter name, created by CDK
- SSM_SHEET_PARAMETER: SSM parameter name, created by CDK
- SQS_QUEUE_URL: SQS Queue URL, created by CDK 

## Setup GitHub Actions CI/CD

GitHub CI/CD is already in place, but a few steps are required:

- Setup a valid AWS role on the secrets at `AWS_ARN_ROLE`, this will be used at:
```
- name: Configure aws credentials
  uses: aws-actions/configure-aws-credentials@v1
  with:
    role-to-assume: ${{ secrets.AWS_ARN_ROLE }}
```
- Add all the environment variables from the CDK step above as
[GitHub Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
for the actions workflows.

## Deployment with AWS CDK

### Prerequisites

- you need to have access to some AWS account (once you get access, use this
[link](https://console.aws.amazon.com/lambda/home?region=us-east-1#/functions)
to access the Lambda functions list).
- set
[aws cli](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-quickstart.html)
up.
  - once `aws-cli` is set up, you need to configure it. Create a new aws profile
    with your AWS IAM keys (this step):
    ```bash
    aws configure --profile profile_name
    ```
- set up
[aws cdk](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_install)

### Installation

First, install all the scripts from package.json:
```bash
npm install
```

Bootstrap CDK
([docs](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_bootstrap))
```bash
cdk bootstrap aws://ACCOUNT-NUMBER/us-east-1
```

### Development

There are two important parts to this project:

- the infrastructure code is in `lib` and `bin` folders
- the lambda handlers (the business logic) in `src` folder

### The infrastructure code

This project uses
[AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/work-with-cdk-javascript.html)
to manage the infrastructure and deployment.
To learn about the concepts used to build apps with CDK take a look at the
[documentation](https://docs.aws.amazon.com/cdk/v2/guide/core_concepts.html).

### The lambda handlers

All the business logic is placed in the lambdas under the `src` folder.

### Test

Tests can be run with:

```bash
npm run test
```

### Manual Deployment

This project is deployed via the AWS CDK. The deploy region is `us-east-1`.
The `cdk.json` file tells the CDK Toolkit how to execute your app. The build
step is not required when using JavaScript.

To manually deploy the stack to AWS, use the following command:
```bash
cdk synth  --profile profile_name
cdk deploy --profile profile_name
```

**NOTE**: Make sure you have `aws-cdk` installed and that you have set up a
valid profile.

Useful commands:

 * `cdk deploy`           deploy this stack to your default AWS account/region
 * `cdk diff`             compare deployed stack with the current state
 * `cdk synth`            emits the synthesized CloudFormation template
