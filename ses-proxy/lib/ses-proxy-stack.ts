import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cdk from 'aws-cdk-lib';
import {NodejsFunction} from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ses from 'aws-cdk-lib/aws-ses'
import { Effect } from 'aws-cdk-lib/aws-iam';
import * as route53 from "aws-cdk-lib/aws-route53";
import { DnsValidatedDomainIdentity } from "aws-cdk-ses-domain-identity";

export class SesProxyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    
    const bucket = new s3.Bucket(this, this.node.tryGetContext('s3_bucket_name'));

    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: this.node.tryGetContext('domain'),
      privateZone: false,
    });

    // const identity = new DnsValidatedDomainIdentity(this, 'DomainIdentity', {
    //   domainName: this.node.tryGetContext('domain'),
    //   dkim: true,
    //   region: process.env.CDK_DEFAULT_REGION,
    //   hostedZone,
    // });

    const sesProxy = new NodejsFunction(this, id, {
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

    sesProxy.role!.attachInlinePolicy(
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
  }
}
