require("dotenv").config();

const {
    createGasQuote
} = require(
    "./src/services/gasQuoteService"
);


async function test() {

    try {

        const quote =
            await createGasQuote({

                network:
                    "BEP20",

                toAddress:
                    "0x000000000000000000000000000000000000dEaD",

                requestedAmount:
                    1

            });


        console.log(
            "\nGAS QUOTE SUCCESS\n"
        );


        console.dir(
            quote,
            {
                depth:
                    null
            }
        );


    } catch (error) {

        console.error(
            "\nGAS QUOTE FAILED\n"
        );

        console.error(
            error.message
        );

    }

}


test();