import dotenv from 'dotenv';
import path from 'path';

// Load .env from the server root
dotenv.config({ path: path.join(__dirname, '../.env') });

import { otpService } from '../src/services/otp.service';

const TEST_NUMBER = '6379571297';

async function runTest() {
    console.log(`🚀 Triggering SMS Invite Test...`);
    console.log(`📱 Target Number: ${TEST_NUMBER}`);
    
    const inviteLink = "https://apps.apple.com/in/app/sawa-made-for-two/id514584879";
    const msg = `Hi! Your partner has invited you to join them on SAWA. Download the app to link your accounts: ${inviteLink}`;

    try {
        const success = await otpService.sendInvitation(TEST_NUMBER, msg);
        
        if (success) {
            console.log(`\x1b[32m\n✅ TEST SUCCESS!\x1b[0m`);
            console.log(`The invitation was successfully dispatched to Twilio for delivery to ${TEST_NUMBER}.\n`);
        } else {
            console.log(`\x1b[31m\n❌ TEST FAILED.\x1b[0m`);
            console.log(`Twilio rejected the request. Make sure your Account SID/Auth Token are correct and you have enabled India permissions.\n`);
        }
    } catch (err: any) {
        console.error(`\x1b[31m\n❌ ERROR: ${err.message}\x1b[0m\n`);
    }
}

runTest();
