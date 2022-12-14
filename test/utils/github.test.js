import tap from 'tap'
import nock from 'nock'
import {
  addMemberToOneTeam,
  ghListOrgTeamMembers,
  getGithubUserFromURL,
  githubHandler,
  removeMemberFromOneTeam
} from '../../src/utils/github.js'
import { getAppConfig, getFromGithubConfig } from '../../src/utils/global.js'
import { initTestEnv } from '../setup-test.js'

tap.before(async () => {
  await initTestEnv()
  nock.disableNetConnect()
})

const githubUrl = 'https://api.github.com'

tap.beforeEach(async () => {
  nock(githubUrl)
    // Mocking Installations
    .get('/app/installations')
    .reply(200, [
      { id: '123', account: { login: getFromGithubConfig('organizationSlug') } }
    ])
    // Mocking access_token
    .post('/app/installations/123/access_tokens')
    .reply(200, {
      token: 'ghs_16C7e42F292c6912E7710c838347Ae178B4a'
    })
})

tap.afterEach(async () => {
  nock.cleanAll()
})

tap.teardown(async () => {
  nock.cleanAll()
  nock.enableNetConnect()
})

tap.test('githubHandler should return a valid instance', async t => {
  const github = await githubHandler()
  t.ok(github)
})

tap.test('githubHandler should fail if github request fails', async t => {
  nock.cleanAll()
  nock(githubUrl).post('/app/installations').reply(403)
  t.rejects(githubHandler(false))
})

tap.test('githubHandler should fail for wrong credentials', async t => {
  nock.cleanAll()
  nock(githubUrl)
    .get('/app/installations')
    .reply(200, [{ id: '123', account: { login: 'WRONG_ORGANIZATION_ID' } }])
  t.rejects(githubHandler(false))
})

tap.test('ghListOrgTeamMembers should call the github url', async t => {
  const org = 'testOrg'
  const teamSlug = 'testTeam'
  const scope = nock(githubUrl)
    .get(`/orgs/${org}/teams/${teamSlug}/members`)
    .query(true)
    .reply(200, [{ login: 'newUser123' }])
  const resp = await ghListOrgTeamMembers(org, teamSlug)
  t.same(resp, [{ login: 'newUser123' }])
  t.ok(scope.isDone())
})

tap.test('addMemberToOneTeam should call the github url', async t => {
  const username = 'therockeng'
  const scope = nock(githubUrl)
    .put(
      `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
        getAppConfig()[0].githubTeam
      }/memberships/${username}`
    )
    .reply(200, { ok: true })
  const resp = await addMemberToOneTeam(
    username,
    getFromGithubConfig('organizationSlug'),
    getAppConfig()[0].githubTeam
  )
  t.same(resp.data, { ok: true })
  t.ok(scope.isDone())
})

tap.test('removeMemberFromOneTeam should call the github url', async t => {
  const username = 'therockeng'
  const scope = nock(githubUrl)
    .delete(
      `/orgs/${getFromGithubConfig('organizationSlug')}/teams/${
        getAppConfig()[0].githubTeam
      }/memberships/${username}`
    )
    .reply(200, { ok: true })
  const resp = await removeMemberFromOneTeam(
    username,
    getFromGithubConfig('organizationSlug'),
    getAppConfig()[0].githubTeam
  )
  t.same(resp.data, { ok: true })
  t.ok(scope.isDone())
})

tap.test('getGithubUserFromURL should return the expected value', async t => {
  t.equal(getGithubUserFromURL('https://github.com/user123'), 'user123')
  t.equal(getGithubUserFromURL('https://user123.github.io'), 'user123')
})
