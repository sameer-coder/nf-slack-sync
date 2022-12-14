// import { promisify } from 'util'
import pem from 'https-pem'

export const initTestEnv = async (useSheet = true) => {
  // const createCertificateProm = promisify(pem.createCertificate)
  // const { serviceKey } = await createCertificateProm({
  //   days: 1,
  //   selfSigned: true
// import pem from 'pem'
  // })
  const serviceKey = pem.key
  const appConfig = [
    { slackChannel: 'EX4MPL3CH4NN3L', githubTeam: 'test-team' }
  ]
  const sheetConfig = [
    {
      serviceAccountKey: {
        type: 'service_account',
        project_id: 'project_id',
        private_key_id: 'private_key_id',
        private_key: serviceKey,
        client_email: 'service-account@project_id.iam.gserviceaccount.com',
        client_id: 'client_id',
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url:
          'https://www.googleapis.com/oauth2/v1/certs',
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
  const slackConfig = {
    signingSecret: 'example-secret',
    botToken: 'example-token',
    githubUrlField: 'EX4MPL31D'
  }
  const githubConfig = {
    organizationSlug: 'exampleorg',
    appId: '100001',
    privateKey: serviceKey
  }

  global.appVariables = {
    appConfig,
    slackConfig,
    sheetConfig: useSheet ? sheetConfig : undefined,
    githubConfig
  }
}
