#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SesProxyStack } from '../lib/ses-proxy-stack';

const env = { 
  account: process.env.CDK_DEFAULT_ACCOUNT, 
  region: process.env.CDK_DEFAULT_REGION 
}

// stacks
const app = new cdk.App();
new SesProxyStack(app, 'SesProxyStack', {env: env});
app.synth();