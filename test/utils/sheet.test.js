import tap from 'tap'
import nock from 'nock'
import * as Sheet from '../../src/utils/sheet.js'
import { getFromSheetConfig } from '../../src/utils/global.js'
import { initTestEnv } from '../setup-test.js'

let sheetsClient

const googleSheetsBaseEndpoint = 'https://sheets.googleapis.com'
const googleApiAuthBaseEndpoint = 'https://www.googleapis.com'

const baseSheet = [
  ['John Appleseed', 'FS', '04/01/2022', '', 'X', 'johnappleseed'],
  ['John Appleseed', 'FS', '04/01/2022', '04/05/2022', 'X', 'johnappleseed'],
  ['John Appleseed', 'FS', '04/10/2022', '', '', 'johnappleseed']
]

const compareEntries = (t, a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    t.fail('Expected arrays for comparison')
  }

  for (const idx in a) {
    t.equal(a[idx], b[idx])
  }
}

tap.before(async () => {
  await initTestEnv()
  nock.disableNetConnect()

  nock(googleApiAuthBaseEndpoint).post('/oauth2/v4/token').reply(200, {
    access_token: 'access_token',
    token_type: 'Bearer',
    expires_in: 3600
  })
  try {
    sheetsClient = await Sheet.authorizeSheetsClient(
      getFromSheetConfig('serviceAccountKey', 0)
    )
  } catch (err) {
    // This will be caught in the tests, no need to break the whole thing
    // with no meaningful information
  }
  nock.cleanAll()
})

tap.beforeEach(async () => {
  nock(googleApiAuthBaseEndpoint)
    .post('/oauth2/v4/token')
    .reply((_, body) => {
      const token = body.split('=').pop()
      const { iss } = JSON.parse(
        // JWT token decoding
        Buffer.from(token.split('.')[1], 'base64').toString()
      )

      if (iss === 'invalid@email.com') {
        return [400, {}]
      }

      return [
        200,
        {
          access_token: 'access_token',
          token_type: 'Bearer',
          expires_in: 3600
        }
      ]
    })

  nock(googleSheetsBaseEndpoint)
    .filteringPath(/values\/[^&?:]+/, 'values/range')
    .get('/v4/spreadsheets/spreadsheet_id/values/range')
    .reply(200, {
      range: 'data!A1:F',
      majorDimension: 'ROWS',
      values: baseSheet
    })
    .post(
      '/v4/spreadsheets/spreadsheet_id/values/range:append?valueInputOption=USER_ENTERED'
    )
    .reply((_, body) => {
      baseSheet.push(...body.values)

      return [
        200,
        {
          spreadsheetId: 'spreadsheet_id',
          tableRange: 'data!A1:E999',
          updates: {
            spreadsheetId: 'spreadsheet_id',
            updatedRange: 'data!A168:E168',
            updatedRows: 1,
            updatedColumns: 6,
            updatedCells: 6
          }
        }
      ]
    })
    .put(
      '/v4/spreadsheets/spreadsheet_id/values/range?valueInputOption=USER_ENTERED'
    )
    .reply((uri, body) => {
      const range = uri.split('/').pop().split('?')[0]
      const idx = Number.parseInt(range.replace(/[!a-zA-Z]/g, ''), 10)

      baseSheet[idx] = body.values[0]

      return [
        200,
        {
          spreadsheetId: 'spreadsheet_id',
          tableRange: 'range',
          updates: {
            spreadsheetId: 'spreadsheet_id',
            updatedRange: range,
            updatedRows: 1,
            updatedColumns: 6,
            updatedCells: 6
          }
        }
      ]
    })
})

tap.afterEach(async () => {
  nock.cleanAll()
})

tap.teardown(async () => {
  nock.cleanAll()
  nock.enableNetConnect()
})

tap.test('sheets handler should not authorize with missing creds', async t => {
  const client = await Sheet.authorizeSheetsClient()
  t.notOk(client)
})

tap.test('sheets handler should throw with invalid creds', async t => {
  const serviceAccountKey = Object.assign(
    {},
    getFromSheetConfig('serviceAccountKey', 0),
    { client_email: 'invalid@email.com' }
  )

  try {
    await Sheet.authorizeSheetsClient(serviceAccountKey)
    t.fail('Should have thrown')
  } catch (error) {
    t.same(error.message, 'Request failed with status code 400')
  }
})

tap.test('sheets handler should authorize with valid creds', async t => {
  const client = await Sheet.authorizeSheetsClient(
    getFromSheetConfig('serviceAccountKey', 0)
  )
  t.ok(client)
})

tap.test(
  'findLastEntryForUserInSheet should not fail if there is no client',
  async t => {
    t.same(await Sheet.findLastEntryForUserInSheet(null, {}, 0), {})
  }
)

tap.test(
  'findLastEntryForUserInSheet should fail if username is not a string',
  async t => {
    try {
      await Sheet.findLastEntryForUserInSheet(sheetsClient, {}, 0)
      t.fail('Should have thrown')
    } catch (error) {
      t.same(error.message, 'Expected username to be string. Got object.')
      t.same(error.username, {})
    }
  }
)

tap.test(
  'findLastEntryForUserInSheet should succeed with valid data',
  async t => {
    const { index, lastEntry } = await Sheet.findLastEntryForUserInSheet(
      sheetsClient,
      'johnappleseed',
      0
    )
    t.ok(lastEntry)
    t.equal(index, 2)

    compareEntries(t, lastEntry, baseSheet[2])
  }
)

tap.test(
  'findLastEntryForUserInSheet should not fail if user is not found',
  async t => {
    const { index, lastEntry } = await Sheet.findLastEntryForUserInSheet(
      sheetsClient,
      'not_in_sheet',
      0
    )
    t.notOk(lastEntry)
    t.notOk(index)
  }
)

tap.test(
  'findLastEntryByRealNameInSheet should not fail if there is no client',
  async t => {
    t.same(await Sheet.findLastEntryByRealNameInSheet(null, {}, 0), {})
  }
)

tap.test(
  'findLastEntryByRealNameInSheet should fail if realName is not a non-empty string',
  async t => {
    await t.rejects(Sheet.findLastEntryByRealNameInSheet(sheetsClient, {}, 0))
    await t.rejects(Sheet.findLastEntryByRealNameInSheet(sheetsClient, '', 0))
  }
)

tap.test(
  'findLastEntryByRealNameInSheet should succeed with valid data',
  async t => {
    const { index, lastEntry } = await Sheet.findLastEntryByRealNameInSheet(
      sheetsClient,
      'John Appleseed',
      0
    )
    t.ok(lastEntry)
    t.equal(index, 2)
    t.same(lastEntry, baseSheet[2])
  }
)

tap.test(
  'findLastEntryByRealNameInSheet should not fail if user is not found',
  async t => {
    const { index, lastEntry } = await Sheet.findLastEntryByRealNameInSheet(
      sheetsClient,
      'nobody',
      0
    )
    t.notOk(lastEntry)
    t.notOk(index)
  }
)

tap.test('formatDateForSheet should return well formatted string', async t => {
  let date = new Date(1650482866281)
  let expectedDateString = '04/20/2022'
  t.equal(Sheet.formatDateForSheet(date, 0), expectedDateString)

  date = new Date(1650504466281)
  expectedDateString = '04/21/2022'
  t.equal(Sheet.formatDateForSheet(date, 0), expectedDateString)

  date = new Date(1650418066281)
  expectedDateString = '04/20/2022'
  t.equal(Sheet.formatDateForSheet(date, 0), expectedDateString)

  date = new Date(1650331666281)
  expectedDateString = '04/19/2022'
  t.equal(Sheet.formatDateForSheet(date, 0), expectedDateString)
})

tap.test('getEntryRowRange should return well formatted range', async t => {
  const previousRange = getFromSheetConfig('dataRange', 0)

  global.appVariables.sheetConfig[0].dataRange = 'data!A2:F'
  let index = 150
  let expectedRange = 'data!A152'
  t.equal(Sheet.getEntryRowRange(index, 0), expectedRange)

  global.appVariables.sheetConfig[0].dataRange = 'A:B'
  index = 10
  expectedRange = 'A11'
  t.equal(Sheet.getEntryRowRange(index, 0), expectedRange)

  global.appVariables.sheetConfig[0].dataRange = '1:20'
  index = 5
  expectedRange = '6'
  t.equal(Sheet.getEntryRowRange(index, 0), expectedRange)

  global.appVariables.sheetConfig[0].dataRange = 'data'
  index = 5
  expectedRange = 'data'
  t.equal(Sheet.getEntryRowRange(index, 0), expectedRange)

  global.appVariables.sheetConfig[0].dataRange = 'sheet!C10:F50'
  index = 30
  expectedRange = 'sheet!C40'
  t.equal(Sheet.getEntryRowRange(index, 0), expectedRange)

  try {
    global.appVariables.sheetConfig[0].dataRange = 'sheet!:Z'
    index = 1
    Sheet.getEntryRowRange(index, 0)
    t.fail('Should have thrown')
  } catch (error) {
    t.same(error.message, 'Invalid data range: sheet!:Z')
  }

  try {
    global.appVariables.sheetConfig[0].dataRange = 'Invalid data range'
    index = 1
    Sheet.getEntryRowRange(index, 0)
    t.fail('Should have thrown')
  } catch (error) {
    t.same(error.message, 'Invalid data range: Invalid data range')
  }

  global.appVariables.sheetConfig[0].dataRange = previousRange
})

tap.test('appendEntryToSpreadsheet should append to the sheet', async t => {
  const entry = ['James Smith', 'FS', '04/20/2022', '', 'X', 'jamessmith']
  await Sheet.appendEntryToSpreadsheet(sheetsClient, entry, 0)

  compareEntries(t, baseSheet[3], entry)
})

tap.test('updateEntryOnSpreadsheet should update specified range', async t => {
  const entry = ['James Smith', 'FS', '05/20/2022', '', 'X', 'jamessmith']
  await Sheet.updateEntryOnSpreadsheet(sheetsClient, entry, 'A3', 0)

  compareEntries(t, baseSheet[3], entry)
})
