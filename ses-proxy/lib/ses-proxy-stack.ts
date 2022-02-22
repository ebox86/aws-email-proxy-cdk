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

export class SesProxyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
  
    // S3 and Lambda
    // --> create s3 bucket for lambda
    const bucket = new s3.Bucket(this, this.node.tryGetContext('s3_bucket_name'));

    // --> create lambda
    const sesProxyLambda = new NodejsFunction(this, id, {
      environment: {
        region: cdk.Stack.of(this).region,
        s3_bucket_name:  this.node.tryGetContext('s3_bucket_name'),
        s3_prefix: this.node.tryGetContext('s3_prefix'),
        from_email: this.node.tryGetContext('from_email'),
        subject_prefix: this.node.tryGetContext('subject_prefix'),
        allow_plus_sign: this.node.tryGetContext('allow_plus_sign')
      },
      runtime: lambda.Runtime.NODEJS_12_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(50),
      handler: 'index.handler',
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
            resources: [`arn:aws:s3:::${this.node.tryGetContext('s3_bucket_name')}/*`]
          })
        ]
      })
    )

    // SES setup
    // --> get hosted zone for domain
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: this.node.tryGetContext('domain'),
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
    const ruleSet = new ses.ReceiptRuleSet(this, 'RuleSet', {
      dropSpam: true
    });
    const defaultRule = ruleSet.addRule('default-proxy-rule');
    
    // --> add actions to the rule
    defaultRule.addAction(new actions.S3({
      bucket,
      objectKeyPrefix: this.node.tryGetContext('s3_prefix')
    }));



    // const identity = new DnsValidatedDomainIdentity(this, 'DomainIdentity', {
    //   domainName: this.node.tryGetContext('domain'),
    //   dkim: true,
    //   region: process.env.CDK_DEFAULT_REGION,
    //   hostedZone,
    // });


  }
}
