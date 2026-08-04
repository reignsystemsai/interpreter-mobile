export function friendlyCallMessage(error: unknown, fallback = 'Unable to connect. Please try again.') {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (/network|fetch|offline|internet|timed? out|websocket/.test(message)) return 'No internet connection.';
  if (/declin/.test(message)) return 'Call declined.';
  if (/unavailable|not found|invite|does not have interpreter/.test(message)) return 'This person does not have Interpreter yet.';
  if (/busy|current call|offline/.test(message)) return 'Unable to connect. Please try again.';
  if (/translation|openai|interpret/.test(message)) return 'The translation service is temporarily unavailable.';
  return fallback;
}

export function terminalCallMessage(status?: string | null) {
  if (status === 'declined') return 'Call declined.';
  if (status === 'busy' || status === 'missed') return 'Unable to connect. Please try again.';
  if (status === 'failed') return 'Call Failed';
  return null;
}
