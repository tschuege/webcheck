const jsdom = require("jsdom");
const {JSDOM} = jsdom;
const fetch = require("node-fetch");
const AWS = require('aws-sdk');
const moment = require('moment');


AWS.config.update({
    region: "eu-west-1"
});

const docClient = new AWS.DynamoDB.DocumentClient();
const snsClient = new AWS.SES({apiVersion: '2010-12-01'});
const tableName = "webcheck";
const email = process.env.EMAIL;

exports.lambda_handler = async (event, context, callback) => {

    try {

        console.log(`check started: ${new Date()}`);

        const pages = await getPagesToCheck();

        console.log(`found active pages to check: ${pages.size}`);

        await pages.forEach(async (page) => {

            // const url = 'http://www.geho.ch/vermietung/freie_wohnungen';
            // const selector = 'article';

            console.log(`getting content from ${page.url}`);

            const newContent = await getContent(page.url, page.selector);

            console.log(`got content from ${page.url}: ${newContent}`);

            if (page.content !== newContent) {

                if (page.content) {
                    // send message!
                    await sendNotification(page.name, page.url, page.content, newContent)
                }
                // save new content
                await updatePageValue(page.name, newContent)
            }

        });

        console.log(`check finished: ${new Date()}`);

        callback();
    }
    catch (err) {
        console.log(`Error: ${err}`);
        callback(err, null);
    }
};

const getContent = async function (url, selector) {

    const response = await fetch(url);
    const body = await response.text();

    if (!selector) {
        return body;
    }

    const dom = new JSDOM(body);
    return dom.window.document.querySelector(selector).textContent;
};

const getPagesToCheck = async function () {

    console.log("Querying sites to check from dynamo DB");

    const params = {
        TableName: tableName,
        IndexName: "status-index",
        KeyConditionExpression: "#stat = :stat",
        ExpressionAttributeNames: {
            "#stat": "status"
        },
        ExpressionAttributeValues: {
            ":stat": "active"
        }
    };

    return new Promise(function (resolve, reject) {
        try {
            docClient.query(params, function (err, data) {
                if (err) {
                    const msg = `Unable to query. Error: ${JSON.stringify(err, null, 2)}`;
                    reject(msg);
                } else {
                    console.log("Query for sites succeeded.");
                    data.Items.forEach(function (item) {
                        console.log(" -", item.name + ": " + item.url);
                    });
                    resolve(data.Items)
                }
            });
        } catch (err) {
            console.log(`Error: ${err}`);
            reject(err);
        }
    });
};

const updatePageValue = async function (name, newContent) {

    console.log(`updating site ${name} with value ${newContent}`);

    return new Promise(function (resolve, reject) {

        const params = {
            TableName: tableName,
            Key: {
                "name": name
            },
            UpdateExpression: "set content = :c, #changeDate = :d",
            ExpressionAttributeNames: {
                "#changeDate": "date"
            },
            ExpressionAttributeValues: {
                ":c": newContent,
                ":d": moment().format('YYYY-MM-DD HH:MM:SS')
            },
            ReturnValues: "UPDATED_NEW"
        };

        docClient.update(params, function (err, data) {
            if (err) {
                const error = `Unable to update item. Error JSON:, ${JSON.stringify(err, null, 2)}`;
                console.log(error);
                reject(error);
            } else {
                const msg = `UpdateItem succeeded:", ${JSON.stringify(data, null, 2)};`
                console.log(msg);
                resolve(msg);
            }
        });
    })
};

const sendNotification = async function (name, url, oldContent, newContent) {

    console.log(`sending notification for site: ${name}, url: ${url}, oldContent: ${oldContent}, newContent: ${newContent}`);

    const textBody = `Name ${name}\nUrl: ${url}\nNew: ${newContent}\nOld: ${oldContent}`;
    const htmlBody = `<h1>Site ${name} changed</h1><table>
<tr><td valign="top">Url</td><td>${url}</td></tr>
<tr><td valign="top">New</td><td>${newContent}</td></tr>
<tr><td valign="top">Old</td><td>${oldContent}</td></tr>
</table>`;

    const mailParams = {
        Destination: {
            /* required */
            ToAddresses: [email]
        },
        Message: {
            /* required */
            Body: {
                /* required */
                Html: {
                    Charset: "UTF-8",
                    Data: htmlBody
                },
                Text: {
                    Charset: "UTF-8",
                    Data: textBody
                }
            },
            Subject: {
                Charset: 'UTF-8',
                Data: `Web Check - Site changed ${name}`
            }
        },
        Source: email
    };

    await snsClient.sendEmail(mailParams).promise();
    console.log('message sent');
};