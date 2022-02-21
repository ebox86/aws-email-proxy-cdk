# aws-email-proxy-cdk
Email proxy using AWS services SES and Lambda. The service can be used to receive emails based off a verified domain in Route53 and send them to a configured list of mappings using SES.
## Credits

Credit for the actual lambda sending logic goes to https://github.com/arithmetric/aws-lambda-ses-forwarder

# setup
These are some rough initial stesp for setup. More to come:

1) First, run `aws configure` to configure your aws account with an iam credential pair for your account.

2) from the `./ses-proxy` directory, run `cdk bootstrap`

3) 