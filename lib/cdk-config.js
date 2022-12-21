import envSchema from 'env-schema'
import S from 'fluent-json-schema'

const schema = S.object()
  .prop('ENVIRONMENT', S.string().required())
  .prop('SLACK_CONFIG', S.string().default('slack_config'))
  .prop('GITHUB_CONFIG', S.string().default('github_config'))
  .prop('APP_CONFIG', S.string().default('app_config'))
  .prop('SHEET_CONFIG', S.string().default('{}'))

export default envSchema({
  schema: schema,
  dotenv: {
    path: './.env.development'
  }
})
