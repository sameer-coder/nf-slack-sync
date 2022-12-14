import tap from 'tap'

import { initTestEnv } from '../setup-test.js'
import {
  getAppConfig,
  getSheetConfig,
  getFromSlackConfig,
  getFromSheetConfig,
  getFromGithubConfig,
  findSheetConfigIndex
} from '../../src/utils/global.js'

tap.before(async () => {
  // Simulate missing sheet configuration at first
  await initTestEnv(false)
})

tap.test('getAppConfig', async t => {
  const appConfig = getAppConfig()
  t.ok(appConfig)
  t.equal(appConfig.length, 1)
  t.ok(appConfig[0].slackChannel)
  t.ok(appConfig[0].githubTeam)
})

tap.test('getFromSlackConfig', async t => {
  t.ok(getFromSlackConfig('signingSecret'))
  t.ok(getFromSlackConfig('githubUrlField'))
  t.ok(getFromSlackConfig('botToken'))
})

tap.test('getFromGithubConfig', async t => {
  t.ok(getFromGithubConfig('organizationSlug'))
  t.ok(getFromGithubConfig('appId'))
  t.ok(getFromGithubConfig('privateKey'))
})

tap.test('sheet functions', async t => {
  // No config scenario
  t.equal(getFromSheetConfig('serviceAccountKey', 0), null)
  t.equal(getFromSheetConfig('anything', 0), null)
  t.same(getSheetConfig(), [])

  const prevConfig = global.appVariables.sheetConfig
  global.appVariables.sheetConfig = {}
  t.equal(findSheetConfigIndex('timezone', 'America/Fortaleza'), -1)
  global.appVariables.sheetConfig = prevConfig

  // Configured
  await initTestEnv(true)
  t.ok(getFromSheetConfig('serviceAccountKey', 0))
  t.equal(getFromSheetConfig('anything', 0), undefined)
  t.ok(getFromSheetConfig('timezone', 0))
  t.ok(getFromSheetConfig('locale', 0))
  t.ok(getFromSheetConfig('dataRange', 0))
  t.ok(getFromSheetConfig('spreadsheetId', 0))

  t.equal(findSheetConfigIndex('timezone', 'Europe/Dublin'), 0)
  t.equal(findSheetConfigIndex('timezone', 'America/Fortaleza'), -1)

  t.ok(getSheetConfig())
})
