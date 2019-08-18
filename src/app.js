const jsdom = require("jsdom");
const {JSDOM} = jsdom;
const fetch = require("node-fetch");
const AWS = require('aws-sdk');
const moment = require('moment');
const diffMatchPatch = require('diff-match-patch-node');

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

        console.log(`found active pages to check: ${pages.length}`);

        await pages.forEach(async (page) => {

            console.log(`getting content from ${page.url}`);

            const newContent = await getContent(page.url, page.selector);

            if (!newContent) {
                console.warn(`Could not get content for ${page.url} - ${page.selector}. Check the url and selector`);
                return Promise.resolve()    ;
            }

            console.log(`got content from ${page.url}: ${newContent}`);

            if (page.content !== newContent) {

                // https://github.com/google/diff-match-patch/wiki/API

                let realChanges = [];
                try {
                    let changes = diffMatchPatch().diff_main(page.content, newContent);
                    diffMatchPatch().diff_cleanupSemantic(changes);

                    // real changes are only those with type != 0 and length of the changes is >=5
                    realChanges = changes.filter((c) => {
                        return c.length === 2 && c[0] !== 0;
                    });

                } catch (err) {
                    console.warn(`Error when evaluating real changes : ${err}`);
                }

                if (page.content) {
                    // send message!
                    await sendNotification(page.name, page.url, realChanges, page.content, newContent)
                }
                // save new content
                await updatePageValue(page.name, newContent)
            } else {
                console.debug(`No change detected for ${page.url}`);
            }

        });

        console.log(`check finished: ${new Date()}`);

        callback();
    } catch (err) {
        console.log(`Error: ${err}`);
        callback(err, null);
    }
};

const getContent = async function (url, selector) {

    const response = await fetch(url);

    if (response) {
        const body = await response.text();

        if (!selector) {
            return body;
        }

        const dom = new JSDOM(body);
        const element = dom.window.document.querySelector(selector);
        if (element) {
            return dom.window.document.querySelector(selector).textContent;
        } else {
            return null;
        }
    } else {
        return null;
    }
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

const sendNotification = async function (name, url, changes, oldContent, newContent) {

    console.log(`sending notification for site: ${name}, url: ${url}, oldContent: ${oldContent}, newContent: ${newContent}`);

    try {

        let partChanges = '<ul>';
        changes.forEach((change) => {

            let color = change[0] === -1 ? 'red' : 'green';
            let textDecoration = change[0] === -1 ? 'line-through' : 'none';


            console.log(`???> ${change}:${color}:${textDecoration}:${change[1]}`);


            partChanges = `${partChanges}<li><span style=\"color: ${color}, text-decoration: ${textDecoration}\">${change[1]}</span></li>`;
        });
        partChanges = `${partChanges}</ul>`;

        const textBody = `Name ${name}\nUrl: ${url}\nNew: ${newContent}\nOld: ${oldContent}`;
        const htmlBody = `<h1>Site ${name} changed</h1><table>
<tr><td valign="top">Url</td><td>${url}</td></tr>
<tr><td valign="top">Changes</td><td>${partChanges}</td></tr>
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
    } catch (err) {
        console.error(`Error when sending notification: ${err}`);
    }

    console.log('message sent');
};