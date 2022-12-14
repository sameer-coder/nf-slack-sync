import tap, { test } from 'tap'
import AWSMOCK from 'aws-sdk-mock'
import { loadConfigFromSSM } from '../../src/utils/ssm.js'

const appConfig = [{ slackChannel: 'EX4MPL3CH4NN3L', githubTeam: 'test-team' }]
const slackConfig = {
  signingSecret: 'example-secret',
  botToken: 'example-token',
  githubUrlField: 'EX4MPL31D'
}
const githubConfig = {
  organizationSlug: 'exampleorg',
  appId: '100001',
  privateKey: 'test'
}
const sheetConfig = [
  {
    serviceAccountKey: {
      type: 'service_account',
      project_id: 'project_id',
      private_key_id: 'private_key_id',
      private_key: 'private_key',
      client_email: 'service-account@project_id.iam.gserviceaccount.com',
      client_id: 'client_id',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      client_x509_cert_url:
        'https://www.googleapis.com/robot/v1/metadata/x509/service-account%40project_id.iam.gserviceaccount.com'
    },
    spreadsheetId: 'spreadsheet_id',
    dataRange: 'data!A1:F',
    locale: 'en-US',
    timezone: 'Europe/Dublin',
    slackChannel: 'EX4MPL3CH4NN3L'
  }
]

const mockAws = () => {
  AWSMOCK.mock('SSM', 'getParameter', (params, call) => {
    if (params.Name.includes('config')) {
      call(null, {
        Parameter: {
          Value: JSON.stringify(appConfig)
        }
      })
    }
    if (params.Name.includes('slack')) {
      call(null, {
        Parameter: {
          Value: JSON.stringify(slackConfig)
        }
      })
    }
    if (params.Name.includes('github')) {
      call(null, {
        Parameter: {
          Value: JSON.stringify(githubConfig)
        }
      })
    }
    if (params.Name.includes('sheet')) {
      call(null, {
        Parameter: {
          Value: JSON.stringify(sheetConfig)
        }
      })
    }
  })
}

test('load all Credentials', async () => {
  mockAws()

  await loadConfigFromSSM({
    loadAppConfig: true,
    loadSlack: true,
    loadGithub: true,
    loadSheet: true
  })
  tap.ok(global.appVariables.githubConfig)
  tap.ok(global.appVariables.appConfig)
  tap.ok(global.appVariables.slackConfig)
  tap.ok(global.appVariables.sheetConfig)
  AWSMOCK.restore('SSM')
})

test('load github and slack Credentials', async () => {
  mockAws()

  await loadConfigFromSSM({
    loadAppConfig: false,
    loadSlack: true,
    loadGithub: true,
    loadSheet: false
  })
  tap.ok(!global.appVariables.appConfig)
  tap.ok(global.appVariables.githubConfig)
  tap.ok(global.appVariables.slackConfig)
  tap.ok(!global.appVariables.sheetConfig)
  AWSMOCK.restore('SSM')
})

test('load github, app and sheet Credentials', async () => {
  mockAws()

  await loadConfigFromSSM({
    loadAppConfig: true,
    loadSlack: false,
    loadGithub: true,
    loadSheet: true
  })
  tap.ok(global.appVariables.appConfig)
  tap.ok(!global.appVariables.slackConfig)
  tap.ok(global.appVariables.githubConfig)
  tap.ok(global.appVariables.sheetConfig)
  AWSMOCK.restore('SSM')
})

test('load slack and app Credentials', async () => {
  mockAws()

  await loadConfigFromSSM({
    loadAppConfig: true,
    loadSlack: true,
    loadGithub: false,
    loadSheet: false
  })
  tap.ok(global.appVariables.appConfig)
  tap.ok(!global.appVariables.githubConfig)
  tap.ok(global.appVariables.slackConfig)
  tap.ok(!global.appVariables.sheetConfig)
  AWSMOCK.restore('SSM')
})
