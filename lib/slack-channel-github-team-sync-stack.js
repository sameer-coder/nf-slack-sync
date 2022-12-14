import { Stack, Tags, Duration } from 'aws-cdk-lib'
import lambda from 'aws-cdk-lib/aws-lambda'
import sqs from 'aws-cdk-lib/aws-sqs'
import iam from 'aws-cdk-lib/aws-iam'
import ssm from 'aws-cdk-lib/aws-ssm'
import logs from 'aws-cdk-lib/aws-logs'
import apigateway from 'aws-cdk-lib/aws-apigateway'
import { Rule, Schedule } from 'aws-cdk-lib/aws-events'
import targets from 'aws-cdk-lib/aws-events-targets'
import cfg from './cdk-config.js'
import { createRequire } from 'module'
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources'
const cmsRequire = createRequire(import.meta.url)
const pkg = cmsRequire('../package.json')

const { SLACK_CONFIG, GITHUB_CONFIG, SHEET_CONFIG, APP_CONFIG, ENVIRONMENT } =
  cfg

export class SlackChannelGithubTeamSync extends Stack {
  /**
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props)

    // Add a tag to all constructs in the stack
    Tags.of(this).add('project_url', pkg.homepage)

    const queue = new sqs.Queue(this, `slack-sync-${ENVIRONMENT}`, {
      visibilityTimeout: Duration.seconds(300)
    })

    const eventSource = new SqsEventSource(queue)

    const SSMSlackConfig = new ssm.StringParameter(
      this,
      `SlackSyncSlackConfiguration-${ENVIRONMENT}`,
      {
        stringValue: SLACK_CONFIG
      }
    )

    const SSMGithubConfig = new ssm.StringParameter(
      this,
      `SlackSyncGithubConfiguration-${ENVIRONMENT}`,
      {
        stringValue: GITHUB_CONFIG
      }
    )

    const SSMSheetConfig = new ssm.StringParameter(
      this,
      `SlackSyncSheetConfiguration-${ENVIRONMENT}`,
      {
        stringValue: SHEET_CONFIG
      }
    )

    const SSMIntegrationConfig = new ssm.StringParameter(
      this,
      `SlackSyncConfiguration-${ENVIRONMENT}`,
      {
        stringValue: APP_CONFIG
      }
    )

    // Slack Event emitter Lambda
    const handler = new lambda.Function(this, `SlackEmitter-${ENVIRONMENT}`, {
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: Duration.seconds(60),
      code: lambda.Code.fromAsset('dist/slackSqsEmitter/'),
      handler: 'index.handler',
      memorySize: 1024,
      logRetention: logs.RetentionDays.FIVE_DAYS,
      environment: {
        SQS_QUEUE_URL: queue.queueUrl,
        SSM_SLACK_PARAMETER: SSMSlackConfig.parameterName,
        SSM_CONFIG_PARAMETER: SSMIntegrationConfig.parameterName
      }
    })

    handler.addToRolePolicy(
      new iam.PolicyStatement({
        resources: [queue.queueArn],
        actions: ['sqs:*']
      })
    )

    handler.addToRolePolicy(
      new iam.PolicyStatement({
        resources: [
          SSMSlackConfig.parameterArn,
          SSMIntegrationConfig.parameterArn
        ],
        actions: ['ssm:GetParameter']
      })
    )

    // Slack Event handler Lambda
    const handlerReceiver = new lambda.Function(
      this,
      `SlackReceiver-${ENVIRONMENT}`,
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        timeout: Duration.seconds(60),
        code: lambda.Code.fromAsset('dist/slackSqsReceiver/'),
        handler: 'index.handler',
        events: [eventSource],
        memorySize: 1024,
        logRetention: logs.RetentionDays.FIVE_DAYS,
        environment: {
          SSM_SLACK_PARAMETER: SSMSlackConfig.parameterName,
          SSM_GITHUB_PARAMETER: SSMGithubConfig.parameterName,
          SSM_SHEET_PARAMETER: SSMSheetConfig.parameterName,
          SSM_CONFIG_PARAMETER: SSMIntegrationConfig.parameterName
        }
      }
    )

    handlerReceiver.addToRolePolicy(
      new iam.PolicyStatement({
        resources: [
          SSMSlackConfig.parameterArn,
          SSMIntegrationConfig.parameterArn,
          SSMGithubConfig.parameterArn,
          SSMSheetConfig.parameterArn
        ],
        actions: ['ssm:GetParameter']
      })
    )

    // Slack Event handler API
    const api = new apigateway.RestApi(this, `SlackEmitterApi-${ENVIRONMENT}`, {
      restApiName: `Slack Github Team ${ENVIRONMENT}`,
      description: 'Manage a Github team mirroring a Slack channel'
    })

    const slackIntegration = new apigateway.LambdaIntegration(handler, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' }
    })

    // POST /
    api.root.addMethod('POST', slackIntegration)

    // Cron Lambda: keep slack-github in sync
    const cronLambda = new lambda.Function(
      this,
      `SlackSyncReceiver-${ENVIRONMENT}`,
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        timeout: Duration.seconds(60),
        code: lambda.Code.fromAsset('dist/cronLambda/'),
        handler: 'index.handler',
        memorySize: 1024,
        logRetention: logs.RetentionDays.FIVE_DAYS,
        environment: {
          SSM_SLACK_PARAMETER: SSMSlackConfig.parameterName,
          SSM_GITHUB_PARAMETER: SSMGithubConfig.parameterName,
          SSM_SHEET_PARAMETER: SSMSheetConfig.parameterName,
          SSM_CONFIG_PARAMETER: SSMIntegrationConfig.parameterName
        }
      }
    )

    cronLambda.addToRolePolicy(
      new iam.PolicyStatement({
        resources: [
          SSMSlackConfig.parameterArn,
          SSMIntegrationConfig.parameterArn,
          SSMGithubConfig.parameterArn,
          SSMSheetConfig.parameterArn
        ],
        actions: ['ssm:GetParameter']
      })
    )

    // Add it to a new Rule
    const rule = new Rule(this, `SlackGithubSyncCron-${ENVIRONMENT}`, {
      schedule: Schedule.cron({ minute: 0, hour: 0 })
    })
    rule.addTarget(new targets.LambdaFunction(cronLambda))
  }
}
