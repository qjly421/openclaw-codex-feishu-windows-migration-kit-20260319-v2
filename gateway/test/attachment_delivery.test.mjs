import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import {
  buildCallbackUrlFromBase,
  buildLocalCardCallbackUrl,
  buildPlanCard,
  buildPlanExecutionPrompt,
  decoratePlanReply,
  extractPublicHttpUrls,
  extractPlanDirective,
  formatOutboundAttachmentFailure,
  handlePlanCardAction,
  isSimpleDirectExecuteCandidate,
  sendOutboundAttachment,
  shouldAutoPlanMessage,
  splitFileForUpload,
} from '../codex_feishu_gateway.mjs';

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'codex-feishu-test-'));
}

function createMockClient(options = {}) {
  const replies = [];
  const imageUploads = [];
  const fileUploads = [];
  return {
    replies,
    imageUploads,
    fileUploads,
    client: {
      im: {
        image: {
          create: async ({ data }) => {
            data.image?.destroy?.();
            imageUploads.push(true);
            if (options.imageCreateError) {
              throw options.imageCreateError;
            }
            return { code: 0, data: { image_key: `img-${imageUploads.length}` } };
          },
        },
        file: {
          create: async ({ data }) => {
            data.file?.destroy?.();
            fileUploads.push(data.file_name);
            return { code: 0, data: { file_key: `file-${fileUploads.length}` } };
          },
        },
        message: {
          reply: async ({ data }) => {
            replies.push({
              msgType: data.msg_type,
              content: JSON.parse(data.content),
            });
            return { code: 0, data: { message_id: `msg-${replies.length}` } };
          },
        },
        v1: {
          message: {
            create: async ({ data }) => {
              replies.push({
                msgType: data.msg_type,
                content: JSON.parse(data.content),
              });
              return { code: 0, data: { message_id: `msg-${replies.length}` } };
            },
          },
        },
      },
    },
  };
}

test('splitFileForUpload splits a file into deterministic parts', async (t) => {
  const tempDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const sourcePath = path.join(tempDir, 'alphabet.bin');
  const original = Buffer.from('abcdefghijklmnopqrstuvwxyz', 'utf8');
  await fs.writeFile(sourcePath, original);

  const splitResult = await splitFileForUpload(sourcePath, 10);
  t.after(async () => {
    await splitResult.cleanup();
  });

  assert.equal(splitResult.parts.length, 3);
  assert.deepEqual(splitResult.parts.map((part) => part.fileName), [
    'alphabet.bin.part01',
    'alphabet.bin.part02',
    'alphabet.bin.part03',
  ]);

  const merged = Buffer.concat(
    await Promise.all(splitResult.parts.map((part) => fs.readFile(part.filePath))),
  );
  assert.deepEqual(merged, original);
});

test('sendOutboundAttachment splits oversized files and sends all parts', async (t) => {
  const tempDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const sourcePath = path.join(tempDir, 'report.bin');
  await fs.writeFile(sourcePath, Buffer.from('abcdefghijklmnopqrstuvwxyz', 'utf8'));

  const mock = createMockClient();
  const result = await sendOutboundAttachment(mock.client, 'msg-root', sourcePath, {
    feishuFileUploadMaxBytes: 10,
    feishuFileSplitChunkBytes: 10,
  });

  assert.equal(result.delivery, 'split');
  assert.equal(result.partCount, 3);
  assert.equal(mock.fileUploads.length, 3);
  assert.deepEqual(mock.replies.map((item) => item.msgType), ['text', 'file', 'file', 'file']);
  assert.match(mock.replies[0].content.text, /split into 3 parts/i);
});

test('sendOutboundAttachment falls back to file delivery when image upload is too large', async (t) => {
  const tempDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const imagePath = path.join(tempDir, 'preview.png');
  await fs.writeFile(imagePath, Buffer.from('not-a-real-png-but-good-enough'));

  const mock = createMockClient({
    imageCreateError: new Error('234006 The file size exceed the max value.'),
  });
  const result = await sendOutboundAttachment(mock.client, 'msg-root', imagePath, {
    feishuFileUploadMaxBytes: 1024,
    feishuFileSplitChunkBytes: 1024,
  });

  assert.equal(result.delivery, 'file-fallback');
  assert.equal(mock.imageUploads.length, 1);
  assert.equal(mock.fileUploads.length, 1);
  assert.deepEqual(mock.replies.map((item) => item.msgType), ['text', 'file']);
  assert.match(mock.replies[0].content.text, /will be sent as a file/i);
});

test('formatOutboundAttachmentFailure returns a friendly oversize message', async (t) => {
  const tempDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const filePath = path.join(tempDir, 'oversize.bin');
  await fs.writeFile(filePath, Buffer.alloc(12, 0x41));

  const message = await formatOutboundAttachmentFailure({
    filePath,
    error: '234006 The file size exceed the max value.',
  });

  assert.match(message, /oversize\.bin/);
  assert.match(message, /exceeds Feishu's 30 MB file upload limit/);
});

test('extractPlanDirective strips the machine block and captures questions', () => {
  const response = [
    'Goal',
    '- Ship the new workflow',
    '',
    '[feishu-plan]',
    'status: needs_input',
    'question: Which repo should I modify?',
    'question: Do you want plan approval before execution?',
    '[/feishu-plan]',
  ].join('\n');

  const extracted = extractPlanDirective(response, 3);

  assert.equal(extracted.cleanText, 'Goal\n- Ship the new workflow');
  assert.deepEqual(extracted.plan, {
    status: 'needs_input',
    questions: [
      'Which repo should I modify?',
      'Do you want plan approval before execution?',
    ],
  });
});

test('decoratePlanReply adds the correct next-step footer', () => {
  assert.match(
    decoratePlanReply('Plan ready.', { status: 'ready', questions: [] }),
    /send \/approve to start implementation/i,
  );
  assert.match(
    decoratePlanReply('Need more info.', { status: 'needs_input', questions: ['one'] }),
    /reply in this chat with the missing info/i,
  );
});

test('simple direct tasks execute immediately while complex tasks enter planning', () => {
  const simpleTaskDecision = shouldAutoPlanMessage({
    event: { message: { chat_type: 'p2p' } },
    command: null,
    classification: { taskLike: true, intent: 'task' },
    attachments: [],
    text: 'Fix the typo in README.md',
    config: { planFirstForTasks: true, autoPlanInGroups: false, simpleTaskMaxChars: 90, simpleTaskMaxLines: 2 },
  });
  const complexTaskDecision = shouldAutoPlanMessage({
    event: { message: { chat_type: 'p2p' } },
    command: null,
    classification: { taskLike: true, intent: 'task' },
    attachments: [],
    text: 'Research the current workflow, design a callback state machine, and add a Feishu card approval flow.',
    config: { planFirstForTasks: true, autoPlanInGroups: false, simpleTaskMaxChars: 90, simpleTaskMaxLines: 2 },
  });
  const groupQuestionDecision = shouldAutoPlanMessage({
    event: { message: { chat_type: 'group' } },
    command: null,
    classification: { taskLike: false, intent: 'question' },
    attachments: [],
    text: 'Can this ship today?',
    config: { planFirstForTasks: true, autoPlanInGroups: false, simpleTaskMaxChars: 90, simpleTaskMaxLines: 2 },
  });

  assert.equal(simpleTaskDecision, false);
  assert.equal(complexTaskDecision, true);
  assert.equal(groupQuestionDecision, false);
});

test('isSimpleDirectExecuteCandidate rejects attachment or multi-step tasks', () => {
  assert.equal(isSimpleDirectExecuteCandidate({
    classification: { taskLike: true, intent: 'task' },
    attachments: [],
    text: 'Rename the env var in the README',
    config: { simpleTaskMaxChars: 90, simpleTaskMaxLines: 2 },
  }), true);
  assert.equal(isSimpleDirectExecuteCandidate({
    classification: { taskLike: true, intent: 'task' },
    attachments: [],
    text: 'First inspect the current implementation, then design the callback flow.',
    config: { simpleTaskMaxChars: 90, simpleTaskMaxLines: 2 },
  }), false);
  assert.equal(isSimpleDirectExecuteCandidate({
    classification: { taskLike: true, intent: 'task' },
    attachments: [{ path: 'C:\\tmp\\a.txt' }],
    text: 'Handle this attachment',
    config: { simpleTaskMaxChars: 90, simpleTaskMaxLines: 2 },
  }), false);
});

test('buildPlanCard renders approval buttons when callbacks are enabled', () => {
  const card = buildPlanCard({
    key: 'chat-1',
    planSession: {
      status: 'awaiting_approval',
      latestPlanText: '1. Inspect the current gateway\n2. Add Feishu card approval',
      updatedAt: '2026-03-13T10:00:00.000Z',
    },
    config: {
      planCardsEnabled: true,
      cardCallbackEnabled: true,
    },
  });

  assert.equal(card.header.title.content, 'Plan ready for approval');
  assert.equal(card.elements.at(-1).tag, 'action');
  assert.equal(card.elements.at(-1).actions.length, 3);
  assert.equal(card.elements.at(-1).actions[0].value.action, 'approve_plan');
});

test('callback URL helpers normalize local and public callback paths', () => {
  assert.equal(
    buildLocalCardCallbackUrl({
      cardCallbackHost: '0.0.0.0',
      cardCallbackPort: 16688,
      cardCallbackPath: '/webhook/card',
    }),
    'http://127.0.0.1:16688/webhook/card',
  );
  assert.equal(
    buildCallbackUrlFromBase('https://example.trycloudflare.com', '/webhook/card'),
    'https://example.trycloudflare.com/webhook/card',
  );
});

test('extractPublicHttpUrls ignores loopback URLs and keeps public endpoints', () => {
  assert.deepEqual(
    extractPublicHttpUrls('ready at http://127.0.0.1:16688/webhook/card and https://demo.trycloudflare.com'),
    ['https://demo.trycloudflare.com'],
  );
});

test('handlePlanCardAction approves and queues execution', async (t) => {
  const tempDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const state = {
    planSessions: {
      'chat-1': {
        status: 'awaiting_approval',
        chatId: 'oc_chat',
        chatType: 'p2p',
        senderOpenId: 'ou_user',
        originalRequest: 'Add card approval',
        latestPlanText: '1. Build card\n2. Handle callback',
        updatedAt: '2026-03-13T10:00:00.000Z',
        lastMessageId: 'om_msg',
      },
    },
    activeRuns: {},
    groupContexts: {},
    chatSessions: {},
    processedMessageIds: {},
    botInfo: {},
    startupNotifications: {},
  };
  const queued = [];
  const card = await handlePlanCardAction({
    actionEvent: {
      open_id: 'ou_user',
      open_message_id: 'om_card',
      action: {
        tag: 'button',
        value: {
          action: 'approve_plan',
          session_key: 'chat-1',
          plan_updated_at: '2026-03-13T10:00:00.000Z',
        },
      },
    },
    state,
    stateFile: path.join(tempDir, 'state.json'),
    config: {
      planCardsEnabled: true,
      cardCallbackEnabled: true,
      cardActionRequireSameUser: true,
      progressUpdates: false,
      replyChunkLimit: 1800,
      progressInitialDelayMs: 0,
      progressUpdateIntervalMs: 0,
      progressMaxMessages: 1,
      planQuestionLimit: 3,
      typingIndicator: false,
    },
    client: {},
    queues: new Map(),
    scheduleExecution: async (payload) => {
      queued.push(payload);
    },
  });

  assert.equal(state.planSessions['chat-1'].status, 'approval_started');
  assert.equal(queued.length, 1);
  assert.equal(queued[0].runText.includes('The user approved the latest plan.'), true);
  assert.equal(card.header.title.content, 'Execution started');
});

test('handlePlanCardAction cancels the pending plan', async (t) => {
  const tempDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const state = {
    planSessions: {
      'chat-1': {
        status: 'awaiting_approval',
        chatId: 'oc_chat',
        chatType: 'p2p',
        senderOpenId: 'ou_user',
        latestPlanText: 'Ship the feature',
        updatedAt: '2026-03-13T10:00:00.000Z',
      },
    },
    activeRuns: {},
    groupContexts: {},
    chatSessions: {},
    processedMessageIds: {},
    botInfo: {},
    startupNotifications: {},
  };

  const card = await handlePlanCardAction({
    actionEvent: {
      open_id: 'ou_user',
      action: {
        tag: 'button',
        value: {
          action: 'cancel_plan',
          session_key: 'chat-1',
          plan_updated_at: '2026-03-13T10:00:00.000Z',
        },
      },
    },
    state,
    stateFile: path.join(tempDir, 'state.json'),
    config: {
      planCardsEnabled: true,
      cardCallbackEnabled: true,
      cardActionRequireSameUser: true,
    },
    client: {},
    queues: new Map(),
  });

  assert.equal(state.planSessions['chat-1'], undefined);
  assert.equal(card.header.title.content, 'Plan canceled');
});

test('buildPlanExecutionPrompt carries the approved plan context forward', () => {
  const prompt = buildPlanExecutionPrompt({
    originalRequest: 'Add a planning workflow',
    latestPlanText: '1. Draft state machine\n2. Add approval command',
  }, 'Use the existing session state file.');

  assert.match(prompt, /The user approved the latest plan/i);
  assert.match(prompt, /Add a planning workflow/);
  assert.match(prompt, /Add approval command/);
  assert.match(prompt, /Use the existing session state file/);
});
