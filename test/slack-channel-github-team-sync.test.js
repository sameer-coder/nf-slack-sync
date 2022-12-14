import cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { SlackChannelGithubTeamSync } from '../lib/slack-channel-github-team-sync-stack.js'
import { test } from 'tap'

// example test. To run these tests, uncomment this file along with the
// example resource in lib/slack-channel-github-team-sync-stack.js
test('Lambda Created', async () => {
  const app = new cdk.App()
  // WHEN
  const stack = new SlackChannelGithubTeamSync(app, 'MyTestStack')
  // THEN
  const template = Template.fromStack(stack)

  template.hasResourceProperties('AWS::Lambda::Function', {
    Handler: 'index.handler',
    Runtime: 'nodejs18.x'
  })
  template.hasResourceProperties('AWS::Events::Rule', {
    ScheduleExpression: 'cron(0 0 * * ? *)'
  })
})
