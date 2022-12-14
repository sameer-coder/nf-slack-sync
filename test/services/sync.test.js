import tap from 'tap'
import nock from 'nock'
import LoggerInit from 'pino'

import { initTestEnv } from '../setup-test.js'
import { authorizeSheetsClient } from '../../src/utils/sheet.js'
import { sync, getErrorMessage } from '../../src/services/sync.js'
import {
  getAppConfig,
  getFromGithubConfig,
  getFromSlackConfig,
  getFromSheetConfig
} from '../../src/utils/global.js'

const logger = LoggerInit({
  enabled: false
})

let sheetsClients
const googleSheetsBaseEndpoint = 'https://sheets.googleapis.com'
const googleApiAuthBaseEndpoint = 'https://www.googleapis.com'

tap.before(async () => {
  await initTestEnv()
  nock.disableNetConnect()

  nock(googleApiAuthBaseEndpoint).post('/oauth2/v4/token').reply(200, {
    access_token: 'access_token',
    token_type: 'Bearer',
    expires_in: 3600
  })
  sheetsClients = [
    await authorizeSheetsClient(getFromSheetConfig('serviceAccountKey', 0))
  ]
  nock.cleanAll()
})

const githubUrl = 'https://api.github.com'
const baseSheet = [
  ['extrau_s_e_r', 'FS', '04/01/2022', '', 'X', 'extrau_s_e_r'],
  ['extrauser_503', 'FS', '04/05/2022', '', 'X', 'extrauser_503']
]

tap.beforeEach(async () => {
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
    .persist()
    .put('/v4/spreadsheets/spreadsheet_id/values/range')
    .reply(200, {
      spreadsheetId: 'spreadsheet_id',
      tableRange: 'range',
      updates: {
        spreadsheetId: 'spreadsheet_id',
        updatedRange: 'range',
        updatedRows: 1,
        updatedColumns: 6,
        updatedCells: 6
      }
    })
    .persist()
})

tap.afterEach(async () => {
  nock.cleanAll()
})

tap.teardown(async () => {
  nock.cleanAll()
  nock.enableNetConnect()
})

tap.test('sync shoud fail if getChannelMembers fails', async t => {
  t.plan(2)
  const client = {
    conversations: {
      members: ({ channel }) => {
        t.equal(channel, getAppConfig()[0].slackChannel)
        throw new Error('Failed slack members request!')
      }
    }
  }
  nock(githubUrl)
    .get(
      `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
        getAppConfig()[0].githubTeam
      }/members`
    )
    .query(true)
    .reply(200, { data: { members: [] } })
  mockOrgMembers([])
  try {
    await sync({ slackClient: { client }, sheetsClients }, logger)
    t.fail('Should have thrown')
  } catch (e) {
    t.equal(e.message, 'Failed slack members request!')
  }
})

tap.test('sync shoud fail if ghListOrgTeamMembers fails', async t => {
  t.plan(2)
  const client = {
    conversations: {
      members: ({ channel }) => {
        t.equal(channel, getAppConfig()[0].slackChannel)
        return { members: ['valid', 'members'] }
      }
    }
  }
  mockOrgMembers([])
  nock(githubUrl)
    .get(
      `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
        getAppConfig()[0].githubTeam
      }/members`
    )
    .query(true)
    .reply(500, 'Failed github members request!')
  try {
    await sync({ slackClient: { client }, sheetsClients }, logger)
  } catch (error) {
    t.equal(error.message, 'Failed github members request!')
  }
})

tap.test(
  'sync should (partially) fail if there is an error while adding a user',
  async t => {
    const username = 'newUser123'
    const ghUser = 'new_user_123'

    const failUsername = 'failUser456'
    const failGhUser = 'fail_user_456'

    const client = {
      conversations: {
        members: () => ({ members: [username, failUsername] })
      },
      users: {
        profile: {
          get: ({ user }) => {
            const fakeUsers = {
              [username]: {
                profile: {
                  fields: {
                    [getFromSlackConfig('githubUrlField')]: {
                      value: `https://github.com/${ghUser}`
                    }
                  }
                }
              },
              [failUsername]: {
                profile: {
                  fields: {
                    [getFromSlackConfig('githubUrlField')]: {
                      value: `https://github.com/${failGhUser}`
                    }
                  }
                }
              }
            }

            return fakeUsers[user]
          }
        }
      }
    }
    nock(githubUrl)
      .get(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/members`
      )
      .query(true)
      .reply(200, [])

    mockOrgMembers([ghUser, failGhUser])

    const addGoodUserRequest = nock(githubUrl)
      .put(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/memberships/${ghUser}`
      )
      .reply(200)
    const addFailUserRequest = nock(githubUrl)
      .put(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/memberships/${failGhUser}`
      )
      .reply(503)

    try {
      await sync({ slackClient: { client }, sheetsClients }, logger)
    } catch (error) {
      t.equal(
        error.message,
        'Some errors occurred during sync:\n' +
          '\tError: Unable to handle removing user fail_user_456. Reason(s):\n' +
          '\t\tHttpError(status: 503)\n'
      )

      t.equal(baseSheet.length, 4)
      t.equal(baseSheet[2][5], ghUser)
      t.equal(baseSheet[3][5], failGhUser)
      baseSheet.pop()
      baseSheet.pop()
    }

    t.ok(addGoodUserRequest.isDone())
    t.ok(addFailUserRequest.isDone())
  }
)

tap.test(
  'sync should (partially) fail if there is an error while removing a user',
  async t => {
    t.plan(3)

    const users = ['USER_123', 'AnotHER_user', 'last']
    const extraUser = 'ExtraU_S_e_r'
    const extraUser503 = 'extraUser_503'

    const client = {
      conversations: {
        members: () => {
          return { members: users }
        }
      },
      users: {
        profile: {
          get: ({ user }) => {
            return {
              profile: {
                fields: {
                  [getFromSlackConfig('githubUrlField')]: {
                    value: `https://github.com/${user.toUpperCase()}`
                  }
                }
              }
            }
          }
        }
      }
    }
    nock(githubUrl)
      .get(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/members`
      )
      .query(true)
      .reply(
        200,
        users
          .map(login => ({ login }))
          .concat([{ login: extraUser }, { login: extraUser503 }])
      )

    mockOrgMembers(users)

    const removeExtraUserRequest = nock(githubUrl)
      .delete(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/memberships/${extraUser.toLowerCase()}`
      )
      .reply(200)
    const removeExtraUser503Request = nock(githubUrl)
      .delete(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/memberships/${extraUser503.toLowerCase()}`
      )
      .reply(503, 'Service Unavailable')

    try {
      await sync({ slackClient: { client }, sheetsClients }, logger)
    } catch (error) {
      t.same(
        error.message,
        'Some errors occurred during sync:\n' +
          '\tError: Unable to handle removing user extrauser_503. Reason(s):\n' +
          '\t\tHttpError(status: 503, data: Service Unavailable)\n'
      )
    }

    t.ok(removeExtraUserRequest.isDone())
    t.ok(removeExtraUser503Request.isDone())
  }
)

tap.test('sync shoud ignore members missing github url and bots', async t => {
  const users = ['USER_123', 'AnotHER_user', 'last']
  const missingGithub = 'ExtraU_S_e_r'
  const bot = 'botUser'
  const client = {
    conversations: {
      members: ({ channel }) => {
        t.equal(channel, getAppConfig()[0].slackChannel)
        return { members: users.concat([missingGithub, bot]) }
      }
    },
    users: {
      profile: {
        get: ({ user }) => {
          if (users.find(u => user === u)) {
            return {
              profile: {
                fields: {
                  [getFromSlackConfig('githubUrlField')]: {
                    value: `https://github.com/${user.toUpperCase()}`
                  }
                }
              }
            }
          } else if (user === missingGithub) {
            return { profile: { fields: {} } }
          } else {
            return { profile: { api_app_id: 'I_am_a_bot' } }
          }
        }
      }
    }
  }

  mockOrgMembers(users)
  nock(githubUrl)
    .get(
      `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
        getAppConfig()[0].githubTeam
      }/members`
    )
    .query(true)
    .reply(
      200,
      users.map(login => ({ login }))
    )

  for (const user of users) {
    nock(githubUrl)
      .delete(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/memberships/${user.toLowerCase()}`
      )
      .reply(200)
  }

  await sync({ slackClient: { client }, sheetsClients }, logger)
})

tap.test('sync shoud call addMember for new users on slack', async t => {
  const username = 'newUser123'
  const ghUser = 'new_user_123'
  const client = {
    conversations: {
      members: ({ channel }) => {
        t.equal(channel, getAppConfig()[0].slackChannel)
        return { members: [username] }
      }
    },
    users: {
      profile: {
        get: ({ user }) => {
          t.equal(user, username)
          return {
            profile: {
              fields: {
                [getFromSlackConfig('githubUrlField')]: {
                  value: `https://github.com/${ghUser}`
                }
              }
            }
          }
        }
      }
    }
  }
  nock(githubUrl)
    .get(
      `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
        getAppConfig()[0].githubTeam
      }/members`
    )
    .query(true)
    .reply(200, [])

  mockOrgMembers([ghUser])

  const scope = nock(githubUrl)
    .put(
      `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
        getAppConfig()[0].githubTeam
      }/memberships/${ghUser}`
    )
    .reply(200)

  await sync({ slackClient: { client }, sheetsClients }, logger)
  t.ok(scope.isDone())
})

tap.test('sync shoud be case insensitive', async t => {
  t.plan(3)
  const username = 'newUser123'
  const ghUser = 'NeW_uSer_123'
  const client = {
    conversations: {
      members: ({ channel }) => {
        t.equal(channel, getAppConfig()[0].slackChannel)
        return { members: [username] }
      }
    },
    users: {
      profile: {
        get: ({ user }) => {
          t.equal(user, username)
          return {
            profile: {
              fields: {
                [getFromSlackConfig('githubUrlField')]: {
                  value: `https://github.com/${ghUser.toLowerCase()}`
                }
              }
            }
          }
        }
      }
    }
  }
  const scope = nock(githubUrl)
    .get(
      `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
        getAppConfig()[0].githubTeam
      }/members`
    )
    .query(true)
    .reply(200, [{ login: ghUser.toUpperCase() }])
  mockOrgMembers([ghUser])

  await sync({ slackClient: { client }, sheetsClients }, logger)
  t.ok(scope.isDone())
})

tap.test('sync shoud remove remaining users from github', async t => {
  t.plan(2)
  const users = ['USER_123', 'AnotHER_user', 'last']
  const extraUser = 'ExtraU_S_e_r'
  const client = {
    conversations: {
      members: ({ channel }) => {
        t.equal(channel, getAppConfig()[0].slackChannel)
        return { members: users }
      }
    },
    users: {
      profile: {
        get: ({ user }) => {
          return {
            profile: {
              fields: {
                [getFromSlackConfig('githubUrlField')]: {
                  value: `https://github.com/${user.toUpperCase()}`
                }
              }
            }
          }
        }
      }
    }
  }
  nock(githubUrl)
    .get(
      `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
        getAppConfig()[0].githubTeam
      }/members`
    )
    .query(true)
    .reply(200, users.map(login => ({ login })).concat({ login: extraUser }))

  mockOrgMembers(users)
  const scope = nock(githubUrl)
    .delete(
      `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
        getAppConfig()[0].githubTeam
      }/memberships/${extraUser.toLowerCase()}`
    )
    .reply(200)

  await sync({ slackClient: { client }, sheetsClients }, logger)
  t.ok(scope.isDone())
})

tap.test('sync shoud remove users from outside the organization', async t => {
  t.plan(2)
  const users = ['USER_123', 'AnotHER_user', 'last']
  const outsider = 'ExtraU_S_e_r'
  const client = {
    conversations: {
      members: ({ channel }) => {
        t.equal(channel, getAppConfig()[0].slackChannel)
        return { members: users.concat(outsider) }
      }
    },
    users: {
      profile: {
        get: ({ user }) => {
          return {
            profile: {
              fields: {
                [getFromSlackConfig('githubUrlField')]: {
                  value: `https://github.com/${user.toUpperCase()}`
                }
              }
            }
          }
        }
      }
    }
  }
  nock(githubUrl)
    .get(
      `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
        getAppConfig()[0].githubTeam
      }/members`
    )
    .query(true)
    .reply(200, users.map(login => ({ login })).concat({ login: outsider }))

  mockOrgMembers(users)
  const scope = nock(githubUrl)
    .delete(
      `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
        getAppConfig()[0].githubTeam
      }/memberships/${outsider.toLowerCase()}`
    )
    .reply(200)

  await sync({ slackClient: { client }, sheetsClients }, logger)
  t.ok(scope.isDone())
})

tap.test(
  'sync should not update sheet if user was already in the github team',
  async t => {
    const users = ['new_user_456']
    const client = {
      conversations: {
        members: ({ channel }) => {
          t.equal(channel, getAppConfig()[0].slackChannel)
          return { members: users }
        }
      },
      users: {
        profile: {
          get: ({ user }) => {
            return {
              profile: {
                fields: {
                  [getFromSlackConfig('githubUrlField')]: {
                    value: `https://github.com/${user.toUpperCase()}`
                  }
                }
              }
            }
          }
        }
      }
    }
    nock(githubUrl)
      .get(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/members`
      )
      .query(true)
      .reply(
        200,
        users.map(login => ({ login }))
      )

    mockOrgMembers(users)

    await sync({ slackClient: { client }, sheetsClients }, logger)
    t.equal(baseSheet.length, 3)
  }
)

tap.test(
  'sync should work even if there are no google sheets clients',
  async t => {
    const username = 'extrauser_503'
    const ghUser = 'extrauser_503'
    const client = {
      conversations: {
        members: ({ channel }) => {
          t.equal(channel, getAppConfig()[0].slackChannel)
          return { members: [username] }
        }
      },
      users: {
        profile: {
          get: ({ user }) => {
            t.equal(user, username)
            return {
              profile: {
                fields: {
                  [getFromSlackConfig('githubUrlField')]: {
                    value: `https://github.com/${ghUser}`
                  }
                }
              }
            }
          }
        }
      }
    }
    nock(githubUrl)
      .get(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/members`
      )
      .query(true)
      .reply(200, [])

    mockOrgMembers([ghUser])

    const scope = nock(githubUrl)
      .put(
        `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
          getAppConfig()[0].githubTeam
        }/memberships/${ghUser}`
      )
      .reply(200)

    await sync({ slackClient: { client } }, logger)
    t.ok(scope.isDone())
  }
)

tap.test('getErrorMessage', t => {
  t.plan(1)
  const message = getErrorMessage(new Error('Random Error'))
  t.equal(message, 'Error(Random Error)')
})

function mockOrgMembers(users) {
  return nock(githubUrl)
    .get(`/orgs/${getFromGithubConfig('organizationSlug')}/members`)
    .query(true)
    .reply(
      200,
      users.map(user => ({ login: user.toLowerCase() }))
    )
}
