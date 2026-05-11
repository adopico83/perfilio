import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
  const { sendBichoNotification } = await import('./lib/notify');

  const result = await sendBichoNotification({
    message: 'El Bicho online. Sistema activo en Perfilio.',
    urgency: 'alta',
    type: 'system_test',
    slug: `test-${Date.now()}`,
  });

  console.log('sendBichoNotification result:', result);
}

main().catch((error) => {
  console.error('sendBichoNotification error:', error);
  process.exit(1);
});
