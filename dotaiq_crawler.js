import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import * as fs from 'fs'

async function getProductAttributes(browser, url) {

    const page = await browser.newPage();
    try {

        //Throw an error if URL is invalid.
        new URL(url)

        //Proxy Server Authentication
        /*await page.authenticate({
            username: '',
            password: ''
          });*/

        await page.setViewport({
            width: Math.floor(Math.random() * (2456 - 1200 + 1)) + 1200,
            height: Math.floor(Math.random() * (1394 - 800 + 1)) + 800,
        });

        page.once('dialog', async dialog => {  //on event listener trigger
            try {
                await dialog.accept(); //accept alert
            } catch (eee) {

            }
        })

        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.4472.124 Safari/537.36',
            // Add other necessary headers
        });

        // Navigate to the URL
        try {
            await page.goto(url, { waitUntil: ['networkidle2'], timeout: 30000 });
        } catch (minorException) {

        }

        try {
            await page.waitForSelector('script[type="application/ld+json"], [itemtype="http://schema.org/Product"]', { timeout: 10000 })
        } catch (minorException) {

        }

        const screenshotBuffer = await page.screenshot();

        // Extract JSON-LD script content
        const productSchema = await page.evaluate(() => {

            var productSchema = null
            var productSchema_qty = 0
            var productSchemaArr = []

            const schemaScripts = document.querySelectorAll('script[type="application/ld+json"]');

            for (const script of schemaScripts) {
                let jsonString = script.textContent;
                jsonString = jsonString.replace(/[\u0000-\u001F\u007F-\u009F]/g, ''); // Remove control characters
                const jsonLD = JSON.parse(jsonString);
                if (jsonLD['@type'] == 'Product') {
                    productSchema = jsonLD
                    productSchema_qty += 1
                    productSchemaArr.push(jsonLD)
                }
                try {
                    if (jsonLD.length > 0) {
                        for (const json of jsonLD) {
                            if (json['@type'] == 'Product') {
                                productSchemaArr.push(json)
                                productSchema = json
                                productSchema_qty += 1
                            }
                        }
                    }
                } catch (eee) {
                    console.log(eee)
                }
            }

            if (productSchema_qty > 1) {
                //more than one product schema

                var newProductSchema = null

                for (const script of schemaScripts) {
                    const jsonLD = JSON.parse(script.textContent)

                    if (jsonLD['@type'] === 'WebPage') {
                        if (jsonLD["mainEntity"] != null) {
                            if ((jsonLD["mainEntity"]["@type"] ?? "") == 'Product') {
                                newProductSchema = jsonLD["mainEntity"]
                            }
                        }
                    }
                }

                if (newProductSchema == null) {
                    productSchema = productSchemaArr[0]
                } else {
                    productSchema = newProductSchema
                }
            }

            if (productSchema == null) {
                //try other method
                var otherMethodProductSchema = { method: 1 }
                const schemaProperties = document.querySelectorAll('[itemtype="http://schema.org/Product"] [itemprop]');
                for (const schemaProperty of schemaProperties) {
                    const itemprop = (schemaProperty.getAttribute('itemprop') ?? "")
                    if (!(itemprop in otherMethodProductSchema)) {
                        otherMethodProductSchema[itemprop] = (schemaProperty.getAttribute('content') ?? schemaProperty.getAttribute('href') ?? "")
                    }
                }
                productSchema = otherMethodProductSchema
            }

            //Tries to get seller name
            if (document.location.origin.includes('mercadolivre')) {
                //Mercado Livre Seller
                try {
                    const seller = document.querySelector("[class*='seller'][class*='sold']").parentNode.querySelectorAll('span')[1].textContent
                    productSchema["seller_marketplace"] = seller
                    if (seller.toLowerCase().replace(/\s/g, '') == 'mercadolivre') {
                        productSchema["site_type"] = 'onlinestore'
                    } else {
                        productSchema["site_type"] = 'marketplace'
                    }
                } catch (ee) {

                }
            } else if (document.location.origin.includes('mercadolivre')) {
                //Magazine Luiza Seller
                try {
                    const propertyToCheck = document.querySelector("[data-testid*='mod-sellerdetails'] [data-testid]")
                    var seller = 'Magalu'
                    if (propertyToCheck.querySelector('svg') == null) {
                        seller = propertyToCheck.querySelector('label').textContent ?? "--"
                    }
                    productSchema["seller_marketplace"] = seller
                    if (seller.toLowerCase().replace(/\s/g, '') == 'magalu') {
                        productSchema["site_type"] = 'onlinestore'
                    } else {
                        productSchema["site_type"] = 'marketplace'
                    }
                } catch (ee) {

                }
            } else if (document.location.origin.includes('kabum')) {
                //Kabum Seller
                var seller = ""
                try {
                    seller = document.querySelector("button[data-testid*='seller']").textContent
                    productSchema["seller_marketplace"] = seller
                } catch (ee) {
                    seller = "KaBuM!"
                    productSchema["seller_marketplace"] = seller
                }
                if (seller.toLowerCase().replace(/\s/g, '') == 'kabum!') {
                    productSchema["site_type"] = 'onlinestore'
                } else {
                    productSchema["site_type"] = 'marketplace'
                }
            } else if (document.location.origin.includes('amazon')) {
                //Amazon Seller
                try {
                    const seller = document.querySelector("[data-csa-c-slot-id*='odf-feature-text-desktop-merchant-info']").innerText
                    productSchema["seller_marketplace"] = seller
                    if (seller.toLowerCase().replace(/\s/g, '') == 'amazon.com.br') {
                        productSchema["site_type"] = 'onlinestore'
                    } else {
                        productSchema["site_type"] = 'marketplace'
                    }
                } catch (ee) {

                }
            }

            console.log(productSchema ?? {})
            return productSchema ?? {}
        });

        const productTitle = productSchema["name"] ?? ""
        const thumbnail = productSchema["image"] ?? ""
        const gtin = productSchema["gtin"] ?? productSchema["gtin13"] ?? productSchema["gtin14"] ?? ""
        const mpn = productSchema["mpn"] ?? ""

        const method = productSchema["method"] ?? 0

        var bestPrice = 0.0
        var inStock = false

        var seller_marketplace = productSchema["seller_marketplace"] ?? ""
        var site_type = productSchema["site_type"] ?? 'onlinestore'

        if (method == 0) {
            bestPrice = parseFloat((productSchema["offers"] ?? {})["price"] ?? "0.0")
            inStock = ((productSchema["offers"] ?? {})["availability"] ?? "http://schema.org/InStock") != "http://schema.org/OutOfStock"
        } else if (method == 1) {
            bestPrice = parseFloat(productSchema["price"] ?? "0.0")
            inStock = (productSchema["availability"] ?? "http://schema.org/InStock") != "http://schema.org/OutOfStock"
        }

        await page.close()

        if (bestPrice == 0.0) {
            return null
        }

        return {
            productTitle: productTitle,
            thumbnail: thumbnail,
            gtin: gtin,
            mpn: mpn,
            bestPrice: bestPrice,
            inStock: inStock,
            screenshotBuffer: screenshotBuffer,
            seller_marketplace: seller_marketplace,
            site_type: site_type
        }

    } catch (error) {
        await page.close()
        return null
    }
}

handleProductCrawling()

export async function handleProductCrawling() {

    var timesToReplicate = 10

    let rawdata = fs.readFileSync('website_list.json');
    let links = JSON.parse(rawdata);

    var arrayOfCrawling = []

    for (var y = 0; y < timesToReplicate; y++) {
        arrayOfCrawling.push(new Promise(async (resolve1, reject1) => {
            var browser = null

            //Launch Browser
            if (browser == null) {
                puppeteer.use(StealthPlugin());
                browser = await puppeteer.launch({
                    headless: false,
                    dumpio: true,
                    protocolTimeout: 3.6e7,
                    args: [
                        '--ignore-certificate-errors',
                        //'--proxy-server='
                    ]
                });
            }
            if (!browser) {
                puppeteer.use(StealthPlugin());
                browser = await puppeteer.launch({
                    headless: false,
                    dumpio: true,
                    protocolTimeout: 3.6e7
                });
            }

            var linksToCrawl = {}

            for (const result of links) {
                const link = result["link"]
                linksToCrawl[link] = false
            }

            var arrayPromisses = []

            for (const link in linksToCrawl) {
                arrayPromisses.push(new Promise(async (resolve, reject) => {
                    const linkCopy = link
                    try {
                        const productSchema = await getProductAttributes(browser, linkCopy)
                        if (productSchema == null) {
                            resolve(null)
                        } else {
                            resolve({ link: linkCopy, productSchema: productSchema })
                        }
                    } catch (eee) {
                        resolve(null)
                    }
                }))
            }

            const resultsCrawling = await Promise.all(arrayPromisses)
            const noNullsResultsCrawling = resultsCrawling.filter(value => value !== null);

            resolve1(noNullsResultsCrawling)
        }))
    }
    
    var finalResults = await Promise.all(arrayOfCrawling)
    finalResults = finalResults.flat();

    //Calculate Ratio
    const ratio = finalResults.length / (links.length * timesToReplicate)

    console.log(finalResults)
    console.log(ratio)
}