import { classifyInboundText, inboundText } from '../services/nudge/nudge.inbound';

jest.mock('../lib/prisma', () => ({ prisma: {} }));
jest.mock('../services/nudge/nudge.engine', () => ({ handleProviderStatus: jest.fn() }));
jest.mock('../services/nudge/nudge.preferences', () => ({ setOptInByPhone: jest.fn() }));
jest.mock('../services/nudge/nudge.actions', () => ({ executeQuickReply: jest.fn() }));
jest.mock('../services/nudge/channels/whatsapp.channel', () => ({ getWhatsAppProvider: () => null }));

describe('WhatsApp inbound — STOP / START', () => {
  it('honours STOP in every casing and with punctuation', () => {
    expect(classifyInboundText('STOP')).toBe('stop');
    expect(classifyInboundText(' stop! ')).toBe('stop');
    expect(classifyInboundText('Unsubscribe.')).toBe('stop');
    expect(classifyInboundText('बंद करो')).toBe('stop');
  });
  it('START and its variants re-enable', () => {
    expect(classifyInboundText('start')).toBe('start');
    expect(classifyInboundText('Resume')).toBe('start');
  });
  it('anything else is not a consent command', () => {
    expect(classifyInboundText('stop sending me moods please')).toBeNull();
    expect(classifyInboundText('')).toBeNull();
    expect(classifyInboundText(undefined)).toBeNull();
  });
  it('reads button titles before plain text', () => {
    expect(inboundText({ text: 'Send love back', buttonReply: { text: 'Send love back' } })).toBe('Send love back');
    expect(inboundText({ interactiveButtonReply: { title: 'Got it' } })).toBe('Got it');
    expect(inboundText({ text: '  hello ' })).toBe('hello');
  });
});
