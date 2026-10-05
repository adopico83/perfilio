import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
  const { sendBichoNotification } = await import('./lib/notify');

  const businessId = process.env.BICHO_TEST_BUSINESS_ID ?? process.argv[2];
  if (!businessId) {
    throw new Error('Indica el UUID del negocio: BICHO_TEST_BUSINESS_ID o primer argumento');
  }

  const result = await sendBichoNotification({
    business_id: businessId,
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
