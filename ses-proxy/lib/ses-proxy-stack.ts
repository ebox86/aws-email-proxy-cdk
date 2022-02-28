import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cdk from 'aws-cdk-lib';
import {NodejsFunction} from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ses from 'aws-cdk-lib/aws-ses'
import * as actions from 'aws-cdk-lib/aws-ses-actions'
import { Effect } from 'aws-cdk-lib/aws-iam';
import * as route53 from "aws-cdk-lib/aws-route53";
import { DnsValidatedDomainIdentity } from "aws-cdk-ses-domain-identity";
import {SesDefaultRuleSetCustomResourceConstruct} from "./ses-default-rule-set-custom-resource-construct";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"

export class SesProxyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    
    // set vars
    let domainName = process.env.DOMAIN_NAME ? process.env.DOMAIN_NAME : this.node.tryGetContext('domain')
    let fromEmail = process.env.FROM_EMAIL ? process.env.FROM_EMAIL : this.node.tryGetContext('from_email')
    
    // DDB
    // --> create table
    const table = new dynamodb.Table(this, 'SES-proxy-forwarding', {
      partitionKey: { name: 'alias', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // S3 and Lambda
    // --> create s3 bucket for lambda
    const bucket = new s3.Bucket(this, this.node.tryGetContext('s3_bucket_name'), {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(365),
        }
      ]
    });

    // --> add bucket policy
    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        sid: "GiveSESPermissionToWriteEmail",
        principals: [
          new iam.ServicePrincipal('ses.amazonaws.com')
        ],
        actions: ['s3:PutObject'],
        resources: [`${bucket.bucketArn}/*`],
        conditions: {
          "StringEquals": {
            "aws:Referer": `${cdk.Stack.of(this).account}`
          }
        }
      })
    )

    // --> create lambda
    const sesProxyLambda = new NodejsFunction(this, id, {
      environment: {
        region: cdk.Stack.of(this).region,
        s3_bucket_name: bucket.bucketName,
        s3_prefix: this.node.tryGetContext('s3_prefix'),
        from_email: fromEmail,
        subject_prefix: this.node.tryGetContext('subject_prefix'),
        allow_plus_sign: this.node.tryGetContext('allow_plus_sign'),
        table_name: table.tableName
      },
      runtime: lambda.Runtime.NODEJS_12_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(50),
      handler: 'handler',
      entry: path.join(__dirname, `/../src/lambda/index.js`),
    });

    // --> attach execution policy to lambda
    sesProxyLambda.role!.attachInlinePolicy(
      new iam.Policy(this, "SES Proxy", {
        statements: [
          new iam.PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              "logs:CreateLogGroup",
              "logs:CreateLogStream",
              "logs:PutLogEvents"
            ],
            resources: ["arn:aws:logs:*:*:*"]
          }),
          new iam.PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["ses:SendRawEmail"],
            resources: ["*"]
          }),
          new iam.PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              "s3:GetObject",
              "s3:PutObject"
            ],
            resources: [`${bucket.bucketArn}/*`]
          })
        ]
      })
    )

    // --> grant the lambda access to read from ddb table
    table.grantReadData(sesProxyLambda);

    // SES setup
    // --> get hosted zone for domain
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: domainName,
      privateZone: false,
    });

    // --> create mx record for ses on domain
    const mxRecord = new route53.MxRecord(this, 'MxRecord', {
      values: [{
        hostName: this.node.tryGetContext('ses_send_endpoint'),
        priority: 10,
      }],
      zone: hostedZone,
      ttl: cdk.Duration.seconds(1800),
    });

    // --> create ses config set
    const cfnConfigurationSet = new ses.CfnConfigurationSet(this, 'SesConfigurationSet', {
      name: 'SesConfigurationSet',
    });

    // --> create a ses config set destination
    const cfnConfigurationSetEventDestinationProps: ses.CfnConfigurationSetEventDestinationProps = {
      configurationSetName: 'SesConfigurationSet',
      eventDestination: {
        matchingEventTypes: ['Hard bounces', 'Complaints', 'Deliveries', 'Rejects', 'Sends'],
        cloudWatchDestination: {
          dimensionConfigurations: [{
            defaultDimensionValue: 'value',
            dimensionName: 'X-Authenticated-Sender',
            dimensionValueSource: 'emailHeader',
          }],
        },
        enabled: true,
        name: 'SES',
      },
    };

    // --> create a ruleSet and create rule
    const defaultRuleSet = new ses.ReceiptRuleSet(this, 'RuleSet', {
      receiptRuleSetName: 'default',
      dropSpam: true,
      rules: [
        {
          enabled: true,
          actions: [
            new actions.S3({
              bucket,
              objectKeyPrefix: this.node.tryGetContext('s3_prefix')
            })
          ]
        },
        {
          enabled: true,
          actions: [
            new actions.Lambda({
              function: sesProxyLambda
            })
          ]
        }
      ]
    });

    // --> activate default ruleset
    new SesDefaultRuleSetCustomResourceConstruct(this, 'cdkCallCustomResourceConstruct', {
      receiptRuleSetName: defaultRuleSet.receiptRuleSetName
    });

    // --> verify the domain for SES
    const identity = new DnsValidatedDomainIdentity(this, 'DomainIdentity', {
      domainName: domainName,
      dkim: true,
      region: process.env.CDK_DEFAULT_REGION,
      hostedZone,
    });
  }
}
