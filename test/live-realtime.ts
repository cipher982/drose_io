#!/usr/bin/env bun
import { LiveChatTester } from './framework/liveChatTester';

function log(message: string) {
  console.log(message);
}

const baseUrl = process.env.API_BASE || 'http://localhost:3000';
const adminPassword = process.env.ADMIN_PASSWORD || 'temp_dev_password_123';
const timeoutMs = process.env.TIMEOUT_MS ? parseInt(process.env.TIMEOUT_MS, 10) : 8000;
const visitorIdArg = process.env.VISITOR_ID;
const visitorMessage = process.env.VISITOR_MESSAGE;
const adminMessage = process.env.ADMIN_MESSAGE;

async function main() {
  log('🧪 Real-time chat end-to-end test');
  log(`🌐 Base URL: ${baseUrl}`);
  const tester = new LiveChatTester({
    baseUrl,
    adminPassword,
    timeoutMs,
    visitorId: visitorIdArg,
    visitorMessage,
    adminMessage,
    logger: log,
  });

  try {
    const result = await tester.run();
    log('');
    log(`Visitor event received: ${result.visitorEventReceived ? '✅' : '❌'}`);
    log(`Admin event received: ${result.adminEventReceived ? '✅' : '❌'}`);
    log(`Visitor ID: ${result.visitorId}`);

    if (!result.ok) {
      log('\n⚠️  Test failed. Diagnostics:');
      result.details.forEach((detail) => log(`  - ${detail}`));
      process.exit(1);
    }

    log('\n🎉 Real-time chat test passed!');

  } catch (error) {
    log('\n❌ Test errored:');
    log(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  }
}

main();
