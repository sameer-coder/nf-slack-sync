import tap from 'tap'
import nock from 'nock'
import LoggerInit from 'pino'

import { initTestEnv } from '../setup-test.js'
import {
  authorizeSheetsClient,
  formatDateForSheet
} from '../../src/utils/sheet.js'
import {
  getAppConfig,
  getFromSlackConfig,
  getFromSheetConfig,
  getFromGithubConfig
} from '../../src/utils/global.js'
import {
  reAddMemberToGithubTeams,
  addMemberToGithubTeam,
  removeMemberFromGithubTeam,
  addMemberLeftEntryToSpreadsheet,
  addMemberJoinedEntryToSpreadsheet,
  addAnonMemberJoinedEntryToSpreadsheet,
  updateMemberGithubProfileInSheets
} from '../../src/services/members.js'

const logger =
  process.env.DEBUG === 'tests'
    ? LoggerInit({ level: 'debug' })
    : LoggerInit({ enabled: false })

let sheetsClient

const googleSheetsBaseEndpoint = 'https://sheets.googleapis.com'
const googleApiAuthBaseEndpoint = 'https://www.googleapis.com'

let baseSheet

tap.before(async () => {
  await initTestEnv()
  nock.disableNetConnect()

  nock(googleApiAuthBaseEndpoint).post('/oauth2/v4/token').reply(200, {
    access_token: 'access_token',
    token_type: 'Bearer',
    expires_in: 3600
  })
  sheetsClient = await authorizeSheetsClient(
    getFromSheetConfig('serviceAccountKey', 0)
  )
  nock.cleanAll()
})

const githubUrl = 'https://api.github.com'

tap.beforeEach(async () => {
  baseSheet = [
    ['John Appleseed', 'FS', '04/01/2022', '04/05/2022', 'X', 'johnappleseed'],
    ['John Appleseed', 'FS', '04/10/2022', '', '', 'johnappleseed'],
    ['Kate Hall', '', '03/04/2025', '21/07/2025', '', 'katehall'],
    ['James Smith', '', '06/07/2025'],
    ['Julia Green', '', formatDateForSheet(new Date(), 0), '', '', 'juliagreen']
  ]
  nock(githubUrl)
    // Mocking Installations
    .get('/app/installations')
    .reply(200, [
      { id: '123', account: { login: getFromGithubConfig('organizationSlug') } }
    ])
    .persist()
    // Mocking access_token
    .post('/app/installations/123/access_tokens')
    .reply(200, {
      token: 'ghs_16C7e42F292c6912E7710c838347Ae178B4a'
    })
    .persist()

  nock(googleSheetsBaseEndpoint)
    .filteringPath(/values\/[^&:]+/, 'values/range')
    .get('/v4/spreadsheets/spreadsheet_id/values/range')
    .reply(200, {
      range: 'data!A1:F',
      majorDimension: 'ROWS',
      values: baseSheet
    })
    .persist()
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
    .put('/v4/spreadsheets/spreadsheet_id/values/range')
    .reply((uri, body) => {
      const range = uri.split('%21').pop().split('?')[0]
      const idx = Number.parseInt(range.replace(/[!a-zA-Z]/g, ''), 10) - 1

      baseSheet[idx] = body.values[0]

      return [
        200,
        {
          spreadsheetId: 'spreadsheet_id',
          tableRange: 'range',
          updates: {
            spreadsheetId: 'spreadsheet_id',
            updatedRange: 'range',
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

function mockCheckOrgMembers(users) {
  const userSet = new Set(users.map(u => u.toLowerCase()))

  return nock(githubUrl)
    .filteringPath(path => {
      const reqUser = path
        .split(`/orgs/${getFromGithubConfig('organizationSlug')}/members/`)
        .pop()
      if (userSet.has(reqUser)) return '/valid_member'
      return '/invalid_member'
    })
    .get('/valid_member')
    .reply(204)
    .persist()
    .get('/invalid_member')
    .reply(404)
    .persist()
}

tap.test(
  'addMemberToGithubTeam should fail when missing github profile',
  async t => {
    const userId = '123'
    const slackEvent = {
      userProfile: {
        fields: {}
      },
      user: userId
    }
    const appSlack = {
      client: {
        chat: {
          postMessage: () => {}
        }
      }
    }
    try {
      await addMemberToGithubTeam(slackEvent, appSlack, logger)
    } catch (error) {
      t.same(error.message, 'Missing Github profile')
    }
  }
)

tap.test(
  'addMemberToGithubTeam should fail if github request fails',
  async t => {
    const userId = '123'
    const username = 'newUser' + Date.now()
    const slackEvent = {
      userProfile: {
        fields: {
          [getFromSlackConfig('githubUrlField')]: {
            value: `https://github.com/${username}`
          }
        }
      },
      user: userId,
      channel: getAppConfig()[0].slackChannel
    }
    const appSlack = {
      client: {
        chat: {
          postMessage: () => {}
        }
      }
    }
    mockCheckOrgMembers([username])
    const scope = nock(githubUrl)
      .put(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/memberships/${username.toLowerCase()}`
      )
      .reply(500, { message: 'Failed request!' })
    try {
      await addMemberToGithubTeam(slackEvent, appSlack, logger)
    } catch (error) {
      t.same(error.message, 'Failed request!')
    }
    t.ok(scope.isDone())
  }
)

tap.test(
  'addMemberToGithubTeam should fail if not a member of github organization',
  async t => {
    const userId = '123'
    const username = 'newUser' + Date.now()
    const slackEvent = {
      userProfile: {
        fields: {
          [getFromSlackConfig('githubUrlField')]: {
            value: `https://github.com/${username}`
          }
        }
      },
      user: userId,
      channel: getAppConfig()[0].slackChannel
    }
    const appSlack = {
      client: {
        chat: {
          postMessage: () => t.fail()
        }
      }
    }
    mockCheckOrgMembers(['different_user'])
    try {
      await addMemberToGithubTeam(slackEvent, appSlack, logger)
    } catch (error) {
      t.same(
        error.message,
        `User ${username.toLowerCase()} is not part of ${getFromGithubConfig(
          'organizationSlug'
        )} organization`
      )
    }
  }
)

tap.test(
  'addMemberToGithubTeam should fail if github team cannot be retrieved',
  async t => {
    t.plan(1)
    const userId = '123'
    const username = 'newUser' + Date.now()
    const slackEvent = {
      userProfile: {
        fields: {
          [getFromSlackConfig('githubUrlField')]: {
            value: `https://github.com/${username}`
          }
        }
      },
      user: userId,
      channel: `${getAppConfig()[0].slackChannel}x` // We modify the channel to make it fail
    }
    const appSlack = {
      client: {
        chat: {
          postMessage: () => t.fail()
        }
      }
    }
    mockCheckOrgMembers([username])

    try {
      await addMemberToGithubTeam(slackEvent, appSlack, logger)
    } catch (error) {
      t.equal(error.message, 'Unable to retrieve Github team reference')
    }
  }
)

tap.test(
  'addMemberToGithubTeam should request github to add member',
  async t => {
    const userId = '123'
    const username = 'newUser' + Date.now()
    const slackEvent = {
      userProfile: {
        fields: {
          [getFromSlackConfig('githubUrlField')]: {
            value: `https://github.com/${username}`
          }
        }
      },
      user: userId,
      channel: getAppConfig()[0].slackChannel
    }
    const appSlack = {
      client: {
        chat: {
          postMessage: () => t.fail()
        }
      }
    }
    mockCheckOrgMembers([username])
    const scope = nock(githubUrl)
      .put(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/memberships/${username.toLowerCase()}`
      )
      .reply(200)
    await addMemberToGithubTeam(slackEvent, appSlack, logger)
    t.ok(scope.isDone())
  }
)

tap.test(
  'removeMemberFromGithubTeam should fail when missing github profile',
  async t => {
    const slackEvent = {
      userProfile: { fields: {} },
      channel: getAppConfig()[0].slackChannel
    }
    const appSlack = {
      client: {
        chat: {
          postMessage: () => {}
        }
      }
    }
    try {
      await removeMemberFromGithubTeam(slackEvent, appSlack, logger)
    } catch (error) {
      t.same(error.message, 'Missing Github profile')
    }
  }
)

tap.test(
  'removeMemberFromGithubTeam should fail if github request fails',
  async t => {
    const username = 'newUser' + Date.now()
    const slackEvent = {
      userProfile: {
        fields: {
          [getFromSlackConfig('githubUrlField')]: {
            value: `https://github.com/${username}`
          }
        }
      },
      channel: getAppConfig()[0].slackChannel
    }
    const appSlack = {
      client: {
        chat: {
          postMessage: () => {}
        }
      }
    }
    mockCheckOrgMembers([username])
    const scope = nock(githubUrl)
      .delete(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/memberships/${username.toLowerCase()}`
      )
      .reply(500, { message: 'Failed request!' })
    try {
      await removeMemberFromGithubTeam(slackEvent, appSlack, logger)
    } catch (error) {
      t.same(error.message, 'Failed request!')
    }
    t.ok(scope.isDone())
  }
)

tap.test(
  'removeMemberFromGithubTeam should fail if github team cannot be retrieved',
  async t => {
    t.plan(1)

    const username = 'newUser' + Date.now()
    const slackEvent = {
      userProfile: {
        fields: {
          [getFromSlackConfig('githubUrlField')]: {
            value: `https://github.com/${username}`
          }
        }
      },
      channel: `${getAppConfig()[0].slackChannel}x` // We modify the channel to make it fail
    }
    const appSlack = {
      client: {
        chat: {
          postMessage: () => {}
        }
      }
    }

    try {
      await removeMemberFromGithubTeam(slackEvent, appSlack, logger)
    } catch (error) {
      t.equal(error.message, 'Unable to retrieve Github team reference')
    }
  }
)

tap.test(
  'removeMemberFromGithubTeam should request github to delete a member',
  async t => {
    const username = 'newUser' + Date.now()
    const slackEvent = {
      userProfile: {
        fields: {
          [getFromSlackConfig('githubUrlField')]: {
            value: `https://github.com/${username}`
          }
        }
      },
      channel: getAppConfig()[0].slackChannel
    }
    const appSlack = {
      client: {
        chat: {
          postMessage: () => {}
        }
      }
    }
    const scope = nock(githubUrl)
      .delete(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/memberships/${username.toLowerCase()}`
      )
      .reply(200)
    await removeMemberFromGithubTeam(slackEvent, appSlack, logger)
    t.ok(scope.isDone())
  }
)

tap.test(
  'reAddMemberToGithubTeams should fail when missing github profile',
  async t => {
    const id = 'userId123'
    const slackEvent = {
      user: { id, profile: { fields: {} } },
      channel: getAppConfig()[0].slackChannel
    }
    const appSlack = {
      client: {
        conversations: {
          members: () => t.fail()
        }
      }
    }
    try {
      await reAddMemberToGithubTeams(slackEvent, appSlack, logger)
    } catch (error) {
      t.same(error.message, 'Missing Github profile')
    }
  }
)

tap.test(
  'reAddMemberToGithubTeams should do nothing for wrong channel',
  async t => {
    const id = 'userId123'
    const userGh = 'userSlug'
    const event = {
      user: {
        id,
        profile: {
          fields: {
            [getFromSlackConfig('githubUrlField')]: {
              value: `https://github.com/${userGh}`
            }
          }
        }
      },
      channel: getAppConfig()[0].slackChannel
    }
    const appSlack = {
      client: {
        conversations: {
          members: ({ channel }) => {
            t.equal(channel, getAppConfig()[0].slackChannel)
            return { members: ['not', 'include', 'the user'] }
          }
        }
      }
    }
    const scope = nock(githubUrl)
      .put(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/memberships/${userGh.toLowerCase()}`
      )
      .reply(500, { message: 'Should not be called' })
    await reAddMemberToGithubTeams(event, appSlack, logger)
    t.notOk(scope.isDone())
  }
)

tap.test(
  'reAddMemberToGithubTeams should fail if github request fails',
  async t => {
    const id = 'userId123'
    const userGh = 'userSlug'
    const event = {
      user: {
        id,
        profile: {
          fields: {
            [getFromSlackConfig('githubUrlField')]: {
              value: `https://github.com/${userGh}`
            }
          }
        }
      },
      channel: getAppConfig()[0].slackChannel
    }
    const appSlack = {
      client: {
        conversations: {
          members: ({ channel }) => {
            t.equal(channel, getAppConfig()[0].slackChannel)
            return { members: [id] }
          }
        }
      }
    }
    const scope = nock(githubUrl)
      .put(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/memberships/${userGh.toLowerCase()}`
      )
      .reply(500, { message: 'Should fail for external reasons' })
    try {
      await reAddMemberToGithubTeams(event, appSlack, logger)
    } catch (error) {
      t.same(error.message, 'Should fail for external reasons')
      t.notOk(scope.isDone())
    }
  }
)

tap.test(
  'reAddMemberToGithubTeams should request github to add a member',
  async t => {
    const id = 'userId123'
    const userGh = 'userSlug'
    const event = {
      user: {
        id,
        profile: {
          fields: {
            [getFromSlackConfig('githubUrlField')]: {
              value: `https://github.com/${userGh}`
            }
          }
        }
      },
      channel: getAppConfig()[0].slackChannel
    }
    const appSlack = {
      client: {
        conversations: {
          members: ({ channel }) => {
            t.equal(channel, getAppConfig()[0].slackChannel)
            return { members: [id] }
          }
        }
      }
    }
    const scope = nock(githubUrl)
      .put(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/memberships/${userGh.toLowerCase()}`
      )
      .reply(200)
    await reAddMemberToGithubTeams(event, appSlack, logger)
    t.ok(scope.isDone())
  }
)

tap.test(
  'addMemberJoinedEntryToSpreadsheet should fail if GitHub info is missing from Slack profile',
  async t => {
    const slackEvent = { userProfile: {} }

    try {
      await addMemberJoinedEntryToSpreadsheet(
        slackEvent,
        sheetsClient,
        0,
        logger
      )

      t.fail('Should have thrown')
    } catch (error) {
      t.equal(baseSheet.length, 5)
      t.same(error.message, 'Missing Github profile')
    }
  }
)

tap.test(
  'addMemberLeftEntryToSpreadsheet should fail if an invalid username is used',
  async t => {
    try {
      await addMemberLeftEntryToSpreadsheet(
        'not_in_the_sheet',
        sheetsClient,
        0,
        logger
      )

      t.fail('Should have failed')
    } catch (error) {
      t.equal(baseSheet.length, 5)
      t.same(
        error.message,
        "Couldn't find previous entry for not_in_the_sheet in the spreadsheet"
      )
    }
  }
)

tap.test(
  'addMemberJoinedEntryToSpreadsheet should not fail if sheetsClient is missing',
  async t => {
    const slackEvent = { userProfile: { real_name: 'John Appleseed' } }
    try {
      await addMemberJoinedEntryToSpreadsheet(slackEvent, null, 0, logger)
      t.ok(true)
    } catch (error) {
      t.fail(error.message)
    }
  }
)

tap.test(
  'addMemberLeftEntryToSpreadsheet should not fail if sheetsClient or username is missing',
  async t => {
    await t.resolves(
      addMemberLeftEntryToSpreadsheet(null, sheetsClient, 0, logger)
    )
    await t.resolves(
      addMemberLeftEntryToSpreadsheet('johnappleseed', null, 0, logger)
    )
    await t.resolves(addMemberLeftEntryToSpreadsheet(null, null, 0, logger))
  }
)

tap.test(
  "addMemberLeftEntryToSpreadsheet should add end date to user's join entry",
  async t => {
    try {
      const joinDate = baseSheet[1][2]

      await addMemberLeftEntryToSpreadsheet(
        'johnappleseed',
        sheetsClient,
        0,
        logger
      )

      t.equal(baseSheet[1][0], 'John Appleseed') // Name
      t.equal(baseSheet[1][2], joinDate)
      t.not(baseSheet[1][3], '') // Leave date
      t.equal(baseSheet[1][4], '') // New hire
      t.equal(baseSheet[1][5], 'johnappleseed') // Github username
    } catch (error) {
      t.fail(error.message)
    }
  }
)

tap.test(
  'addMemberJoinedEntryToSpreadsheet should append correct data for pre-existing user',
  async t => {
    const slackEvent = {
      userProfile: {
        real_name_normalized: 'Should not use this field',
        fields: {
          [getFromSlackConfig('githubUrlField')]: {
            value: 'https://github.com/johnappleseed'
          }
        }
      }
    }

    try {
      await addMemberJoinedEntryToSpreadsheet(
        slackEvent,
        sheetsClient,
        0,
        logger
      )

      t.equal(baseSheet.length, 6)
      t.equal(baseSheet[5][0], 'John Appleseed') // Name
      t.equal(baseSheet[5][3], '') // Leave date
      t.equal(baseSheet[5][4], '') // New hire
      t.equal(baseSheet[5][5], 'johnappleseed') // Github username
    } catch (error) {
      t.fail(error.message)
    }
  }
)

tap.test(
  'addMemberJoinedEntryToSpreadsheet should append correct data for new hire',
  async t => {
    const slackEvent = {
      userProfile: {
        real_name_normalized: 'James Smith',
        fields: {
          [getFromSlackConfig('githubUrlField')]: {
            value: 'https://github.com/jamessmith'
          }
        }
      }
    }

    try {
      await addMemberJoinedEntryToSpreadsheet(
        slackEvent,
        sheetsClient,
        0,
        logger
      )

      t.equal(baseSheet.length, 6)
      t.equal(baseSheet[5][0], 'James Smith') // Name
      t.equal(baseSheet[5][3], '') // Leave date
      t.equal(baseSheet[5][4], '') // New hire
      t.equal(baseSheet[5][5], 'jamessmith') // Github username
    } catch (error) {
      t.fail(error.message)
    }
  }
)

tap.test(
  'addMemberJoinedEntryToSpreadsheet should not add new entry if user was already added in the same day',
  async t => {
    const slackEvent = {
      userProfile: {
        real_name: 'Julia Green',
        fields: {
          [getFromSlackConfig('githubUrlField')]: {
            value: 'https://github.com/juliagreen'
          }
        }
      }
    }

    t.equal(baseSheet.length, 5)

    // try and add user again
    await t.resolves(
      addMemberJoinedEntryToSpreadsheet(slackEvent, sheetsClient, 0, logger)
    )
    // bash sheet has not grown
    t.equal(baseSheet.length, 5)
  }
)

tap.test(
  'addAnonMemberJoinedEntryToSpreadsheet should add new entry with real name and start date only',
  async t => {
    const slackEvent = {
      userProfile: { real_name: 'James Smith', fields: {} }
    }

    try {
      await addAnonMemberJoinedEntryToSpreadsheet(
        slackEvent,
        sheetsClient,
        0,
        logger
      )

      t.equal(baseSheet.length, 6)
      t.equal(baseSheet[5][0], 'James Smith') // Name
      t.equal(baseSheet[5][1], '') // Position
      t.equal(baseSheet[5][2], formatDateForSheet(new Date(), 0)) // Start Date
      t.equal(baseSheet[5][3], '') // Leave date
      t.equal(baseSheet[5][4], '') // New hire
      t.equal(baseSheet[5][5], '') // Github username
    } catch (error) {
      t.fail(error.message)
    }
  }
)

tap.test(
  'addAnonMemberJoinedEntryToSpreadsheet should exit without throwing if sheets config is not present',
  async t => {
    const slackEvent = {
      userProfile: { real_name: 'James Smith', fields: {} }
    }

    await t.resolves(
      addAnonMemberJoinedEntryToSpreadsheet(slackEvent, null, 0, logger)
    )
    t.equal(baseSheet.length, 5)
    await t.resolves(
      addAnonMemberJoinedEntryToSpreadsheet(
        slackEvent,
        sheetsClient,
        -1,
        logger
      )
    )
    t.equal(baseSheet.length, 5)
  }
)

tap.test(
  'addMemberLeftEntryToSpreadsheet should behave correctly with slack event',
  async t => {
    try {
      const joinDate = baseSheet[1][2]
      const slackEvent = {
        userProfile: {
          real_name_normalized: 'John Appleseed',
          fields: {
            [getFromSlackConfig('githubUrlField')]: {
              value: 'https://github.com/johnappleseed'
            }
          }
        }
      }

      await addMemberLeftEntryToSpreadsheet(slackEvent, sheetsClient, 0, logger)

      t.equal(baseSheet.length, 5)
      t.equal(baseSheet[1][0], 'John Appleseed') // Name
      t.equal(baseSheet[1][2], joinDate) // Last join date
      t.not(baseSheet[1][3], '') // Leave date
      t.equal(baseSheet[1][4], '') // New hire
      t.equal(baseSheet[1][5], 'johnappleseed') // Github username
    } catch (error) {
      t.fail(error.message)
    }
  }
)

tap.test(
  'addMemberLeftEntryToSpreadsheet should fail if last entry already has end date',
  async t => {
    try {
      const slackEvent = {
        userProfile: {
          real_name_normalized: 'Kate Hall',
          fields: {
            [getFromSlackConfig('githubUrlField')]: {
              value: 'https://github.com/katehall'
            }
          }
        }
      }

      await addMemberLeftEntryToSpreadsheet(slackEvent, sheetsClient, 0, logger)
      t.fail('Should have thrown')
    } catch (error) {
      t.same(
        error.message,
        "katehall's last entry in the spreadsheet already has an end date"
      )
    }
  }
)

tap.test(
  'updateMemberGithubProfileInSheets should edit last entry in sheet if github profile is missing',
  async t => {
    const id = '1234'
    const userGh = 'jamessmith'
    const slackEvent = {
      user: { id },
      userProfile: {
        real_name_normalized: 'James Smith',
        fields: {
          [getFromSlackConfig('githubUrlField')]: {
            value: `https://github.com/${userGh}`
          }
        }
      },
      channel: getAppConfig()[0].slackChannel
    }
    const slackClient = {
      client: {
        conversations: {
          members: ({ channel }) => {
            t.equal(channel, getAppConfig()[0].slackChannel)
            return { members: [id] }
          }
        }
      }
    }
    try {
      await updateMemberGithubProfileInSheets(
        slackEvent,
        { slackClient, sheetsClients: [sheetsClient] },
        logger
      )
      t.same(baseSheet[3], ['James Smith', '', '06/07/2025', '', '', userGh])
    } catch (err) {
      t.fail(err.message)
    }
  }
)

tap.test(
  'updateMemberGithubProfileInSheets should exit without throwing if sheets config is not present',
  async t => {
    const entry = JSON.parse(JSON.stringify(baseSheet[3]))
    await t.resolves(
      updateMemberGithubProfileInSheets(
        null,
        { slackClient: {}, sheetsClients: [] },
        logger
      )
    )
    t.same(baseSheet[3], entry)
  }
)

tap.test(
  'updateMemberGithubProfileInSheets should not update sheet if user has no github username',
  async t => {
    const id = '1234'
    const slackEvent = {
      user: { id },
      userProfile: { real_name_normalized: 'James Smith' },
      channel: getAppConfig()[0].slackChannel
    }
    const slackClient = {
      client: {
        conversations: {
          members: ({ channel }) => {
            t.equal(channel, getAppConfig()[0].slackChannel)
            return { members: [id] }
          }
        }
      }
    }

    const entry = JSON.parse(JSON.stringify(baseSheet[3]))
    await t.rejects(
      updateMemberGithubProfileInSheets(
        slackEvent,
        { slackClient, sheetsClients: [sheetsClient] },
        logger
      )
    )
    t.same(baseSheet[3], entry)
  }
)

tap.test(
  'updateMemberGithubProfileInSheets should exit without throwing if user does not exist in sheet',
  async t => {
    const id = '1234'
    const userGh = 'janesmith'
    const slackEvent = {
      user: { id },
      userProfile: {
        real_name_normalized: 'Jane Smith',
        fields: {
          [getFromSlackConfig('githubUrlField')]: {
            value: `https://github.com/${userGh}`
          }
        }
      },
      channel: getAppConfig()[0].slackChannel
    }
    const slackClient = {
      client: {
        conversations: {
          members: ({ channel }) => {
            t.equal(channel, getAppConfig()[0].slackChannel)
            return { members: [id] }
          }
        }
      }
    }

    const entry = JSON.parse(JSON.stringify(baseSheet[3]))
    await t.resolves(
      updateMemberGithubProfileInSheets(
        slackEvent,
        { slackClient, sheetsClients: [sheetsClient] },
        logger
      )
    )
    t.same(baseSheet[3], entry)
  }
)

tap.test(
  'updateMemberGithubProfileInSheets shoudl exit without throwing if user already has github username',
  async t => {
    const id = '1234'
    const userGh = 'juliagreen'
    const slackEvent = {
      user: { id },
      userProfile: {
        real_name: 'Julia Green',
        fields: {
          [getFromSlackConfig('githubUrlField')]: {
            value: `https://github.com/${userGh}`
          }
        }
      },
      channel: getAppConfig()[0].slackChannel
    }
    const slackClient = {
      client: {
        conversations: {
          members: ({ channel }) => {
            t.equal(channel, getAppConfig()[0].slackChannel)
            return { members: [id] }
          }
        }
      }
    }

    const entry = JSON.parse(JSON.stringify(baseSheet[4]))
    await t.resolves(
      updateMemberGithubProfileInSheets(
        slackEvent,
        { slackClient, sheetsClients: [sheetsClient] },
        logger
      )
    )
    t.same(baseSheet[4], entry)
  }
)

tap.test(
  'updateMemberGithubProfileInSheets should exit without throwing if user is not in any watched channels',
  async t => {
    const id = '1234'
    const userGh = 'jamessmith'
    const slackEvent = {
      user: { id },
      userProfile: {
        real_name_normalized: 'James Smith',
        fields: {
          [getFromSlackConfig('githubUrlField')]: {
            value: `https://github.com/${userGh}`
          }
        }
      },
      channel: getAppConfig()[0].slackChannel
    }
    const slackClient = {
      client: {
        conversations: {
          members: ({ channel }) => {
            t.equal(channel, getAppConfig()[0].slackChannel)
            return { members: ['456'] }
          }
        }
      }
    }
    const entry = JSON.parse(JSON.stringify(baseSheet[3]))
    await t.resolves(
      updateMemberGithubProfileInSheets(
        slackEvent,
        { slackClient, sheetsClients: [sheetsClient] },
        logger
      )
    )
    t.same(baseSheet[3], entry)
  }
)
