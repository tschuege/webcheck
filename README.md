# Info

https://github.com/awslabs/aws-sam-cli/blob/develop/docs/getting_started.rst


# Debug

set the variables in template.yml (if not invoked with --profile) under Properties.Environment.Variables
          AWS_ACCESS_KEY_ID: [accessKey]
          AWS_SECRET_ACCESS_KEY: [secretKey]

echo '{"defaultHours": [8,20]}' | sam local invoke "WebCheckFunction" --profile [profilename]

# Deploy

sam package --template-file template.yaml --output-template-file packaged.yaml --s3-bucket tschuege-deployments --profile [profilename]

aws cloudformation deploy --template-file /Users/juerg/dev/private/webcheck/packaged.yaml --capabilities CAPABILITY_IAM --stack-name webcheck --profile [profilename]


# Config

Lambda gets triggered by cloud front rule
