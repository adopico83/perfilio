// Los tests antiguos del agente simulan el tool calling libre del modelo: se ejecutan con el motor «legacy».
// Los tests del motor .jev lo activan a propósito (`process.env.AGENTE_MOTOR = 'jev'`).
process.env.AGENTE_MOTOR = process.env.AGENTE_MOTOR || 'legacy';
