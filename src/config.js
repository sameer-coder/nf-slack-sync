import envSchema from 'env-schema'
import S from 'fluent-json-schema'

const schema = S.object()
  .prop(
    'SSM_SLACK_PARAMETER',
    S.string().default('slack_config_parameter_name')
  )
  .prop(
    'SSM_GITHUB_PARAMETER',
    S.string().default('github_config_parameter_name')
  )
  .prop(
    'SSM_SHEET_PARAMETER',
    S.string().default('sheet_config_parameter_name')
  )
  .prop('SSM_CONFIG_PARAMETER', S.string().default('app_config_parameter_name'))
  .prop('SQS_QUEUE_URL', S.string().default('queue_url'))

export default envSchema({
  schema: schema,
  dotenv: {
    path: './.env.development'
  }
})
