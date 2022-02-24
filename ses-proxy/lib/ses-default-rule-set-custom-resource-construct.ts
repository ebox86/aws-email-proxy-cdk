import {Duration} from "aws-cdk-lib";
import {Construct} from "constructs";
import {AwsCustomResource, AwsCustomResourcePolicy, AwsSdkCall, PhysicalResourceId} from "aws-cdk-lib/custom-resources";
import {RetentionDays} from "aws-cdk-lib/aws-logs";
import {Effect, PolicyStatement} from "aws-cdk-lib/aws-iam";

export interface SesDefaultRuleSetCustomResourceConstructProps {
    receiptRuleSetName: string
}

export class SesDefaultRuleSetCustomResourceConstruct extends Construct {

    constructor(scope: Construct, id: string, props: SesDefaultRuleSetCustomResourceConstructProps) {
        super(scope, id);
        this.insertRecord(props.receiptRuleSetName);
    }

    private insertRecord( rulseSetName: string) {
        const awsSdkCall: AwsSdkCall = {
            service: 'SES',
            action: 'setActiveReceiptRuleSet',
            physicalResourceId: PhysicalResourceId.of('DefaultSesCustomResource'),
            parameters: {
                RuleSetName: rulseSetName,
            }
        }

        const customResource: AwsCustomResource = new AwsCustomResource(this, "ses_default_rule_set_custom_resource", {
                onCreate: awsSdkCall,
                onUpdate: awsSdkCall,
                logRetention: RetentionDays.ONE_WEEK,
                policy: AwsCustomResourcePolicy.fromStatements([
                    new PolicyStatement({
                        sid: 'SesCustomResourceSetActiveReceiptRuleSet',
                        effect: Effect.ALLOW,
                        actions: ['ses:SetActiveReceiptRuleSet'],
                        resources: ['*']
                    })
                ]),
                //timeout: Duration.seconds(30)
            }
        );
    }
}