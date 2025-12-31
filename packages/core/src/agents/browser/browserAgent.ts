/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContentGenerator } from '../../core/contentGenerator.js';
import { BrowserTools } from './browserTools.js';
import { BrowserManager } from './browserManager.js';
import {
  type Content,
  type Part,
  type Tool,
  type FunctionCall,
  Type,
} from '@google/genai';
import { GeminiChat, StreamEventType } from '../../core/geminiChat.js';
import { parseThought } from '../../utils/thoughtUtils.js';
import type { Config } from '../../config/config.js';

import * as os from 'node:os';

import { BrowserLogger } from './browserLogger.js';
import { debugLogger } from '../../utils/debugLogger.js';

// Semantic Tools (Orchestrator)
// Tools use `uid` from the accessibility tree snapshot, not CSS selectors
const semanticTools: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'navigate',
        description: 'Navigates the browser to a specific URL.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            url: { type: Type.STRING, description: 'The URL to visit' },
          },
          required: ['url'],
        },
      },
      {
        name: 'click',
        description:
          'Click on an element using its uid from the accessibility tree snapshot.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            uid: {
              type: Type.STRING,
              description:
                'The uid of the element from the accessibility tree (e.g., "87_4" for a button)',
            },
            dblClick: {
              type: Type.BOOLEAN,
              description: 'Set to true for double clicks. Default is false.',
            },
          },
          required: ['uid'],
        },
      },
      {
        name: 'hover',
        description: 'Hover over the provided element.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            uid: {
              type: Type.STRING,
              description:
                'The uid of the element from the accessibility tree (e.g., "87_4" for a button)',
            },
          },
          required: ['uid'],
        },
      },
      {
        name: 'fill',
        description:
          'Type text into a input, text area or select an option from a <select> element.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            uid: {
              type: Type.STRING,
              description: 'The uid of the element (input/select)',
            },
            value: {
              type: Type.STRING,
              description: 'The value to fill in',
            },
          },
          required: ['uid', 'value'],
        },
      },
      {
        name: 'fill_form',
        description: 'Fill out multiple form elements at once.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            elements: {
              type: Type.ARRAY,
              description: 'Elements from snapshot to fill out.',
              items: {
                type: Type.OBJECT,
                properties: {
                  uid: {
                    type: Type.STRING,
                    description: 'The uid of the element to fill out',
                  },
                  value: {
                    type: Type.STRING,
                    description: 'Value for the element',
                  },
                },
                required: ['uid', 'value'],
              },
            },
          },
          required: ['elements'],
        },
      },
      {
        name: 'upload_file',
        description: 'Upload a file through a provided element.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            uid: {
              type: Type.STRING,
              description:
                'The uid of the file input element or an element that will open file chooser',
            },
            filePath: {
              type: Type.STRING,
              description: 'The local path of the file to upload',
            },
          },
          required: ['uid', 'filePath'],
        },
      },
      {
        name: 'get_element_text',
        description:
          'Get the text content of an element using its uid from the accessibility tree.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            uid: {
              type: Type.STRING,
              description: 'The uid of the element from the accessibility tree',
            },
          },
          required: ['uid'],
        },
      },
      {
        name: 'scroll_document',
        description: 'Scroll the document.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            direction: {
              type: Type.STRING,
              enum: ['up', 'down', 'left', 'right'],
            },
            amount: { type: Type.NUMBER, description: 'Pixels to scroll' },
          },
          required: ['direction', 'amount'],
        },
      },
      {
        name: 'pagedown',
        description: 'Scroll down by one page height.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
      {
        name: 'pageup',
        description: 'Scroll up by one page height.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
      {
        name: 'take_snapshot',
        description:
          'Returns a text snapshot of the page accessibility tree. Use this to read the page content semantically.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            verbose: {
              type: Type.BOOLEAN,
              description: 'Whether to include full details',
            },
          },
        },
      },
      {
        name: 'wait_for',
        description:
          'Waits for specific text to appear on the page. Use this after actions that trigger loading.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: 'The text to wait for' },
          },
          required: ['text'],
        },
      },
      {
        name: 'handle_dialog',
        description:
          'Handles a native browser dialog (alert, confirm, prompt).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING, enum: ['accept', 'dismiss'] },
            promptText: { type: Type.STRING },
          },
          required: ['action'],
        },
      },
      {
        name: 'evaluate_script',
        description:
          'Evaluate a JavaScript function inside the currently selected page. Returns the response as JSON so returned values have to JSON-serializable.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            function: {
              type: Type.STRING,
              description:
                'A JavaScript function declaration to be executed by the tool in the currently selected page. Example without arguments: `() => { return document.title }` or `async () => { return await fetch("example.com") }`. Example with arguments: `(el) => { return el.innerText; }`',
            },
            args: {
              type: Type.ARRAY,
              description:
                'An optional list of arguments to pass to the function.',
              items: {
                type: Type.OBJECT,
                properties: {
                  uid: {
                    type: Type.STRING,
                    description:
                      'The uid of an element on the page from the page content snapshot',
                  },
                },
              },
            },
          },
          required: ['function'],
        },
      },
      {
        name: 'press_key',
        description:
          'Press a key or key combination (e.g., "Enter", "Control+A").',
        parameters: {
          type: Type.OBJECT,
          properties: {
            key: { type: Type.STRING, description: 'The key to press' },
          },
          required: ['key'],
        },
      },
      {
        name: 'open_web_browser',
        description: 'Opens the web browser if not already open.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
      {
        name: 'complete_task',
        description:
          "Call this when you have completely fulfilled the user's request. You MUST call this to exit the agent loop.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description: 'A brief summary of what was accomplished',
            },
          },
          required: ['summary'],
        },
      },
      {
        name: 'delegate_to_visual_agent',
        description:
          'Delegate a task that requires visual interaction (coordinate-based clicks, complex drag-and-drop) OR visual identification (finding elements by color, layout, or visual appearance not in the AX tree).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            instruction: {
              type: Type.STRING,
              description:
                'Clear instruction for the visual agent (e.g., "Click the blue submit button", "Find the yellow letter").',
            },
          },
          required: ['instruction'],
        },
      },
    ],
  },
];

// Visual Tools (Delegate)
const visualTools: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'click_at',
        description: 'Click at specific coordinates.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            x: { type: Type.NUMBER },
            y: { type: Type.NUMBER },
          },
          required: ['x', 'y'],
        },
      },
      {
        name: 'type_text_at',
        description: 'Type text at specific coordinates.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            x: { type: Type.NUMBER },
            y: { type: Type.NUMBER },
            text: { type: Type.STRING },
            press_enter: { type: Type.BOOLEAN },
            clear_before_typing: { type: Type.BOOLEAN },
          },
          required: ['x', 'y', 'text'],
        },
      },
      {
        name: 'drag_and_drop',
        description: 'Drag from one coordinate to another.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            x: { type: Type.NUMBER },
            y: { type: Type.NUMBER },
            dest_x: { type: Type.NUMBER },
            dest_y: { type: Type.NUMBER },
          },
          required: ['x', 'y', 'dest_x', 'dest_y'],
        },
      },
      {
        name: 'press_key', // Also useful helper for visual agent
        description:
          'Press a key or key combination (e.g., "Enter", "Control+A").',
        parameters: {
          type: Type.OBJECT,
          properties: {
            key: { type: Type.STRING, description: 'The key to press' },
          },
          required: ['key'],
        },
      },
      {
        name: 'scroll_document', // Scrolling might be needed
        description: 'Scroll the document.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            direction: {
              type: Type.STRING,
              enum: ['up', 'down', 'left', 'right'],
            },
            amount: {
              type: Type.NUMBER,
              description: 'Pixels to scroll (e.g. 500)',
            },
          },
          required: ['direction', 'amount'],
        },
      },
    ],
  },
];

export class BrowserAgent {
  private logger: BrowserLogger;
  private browserManager: BrowserManager;
  private browserTools: BrowserTools;

  constructor(
    private generator: ContentGenerator,
    private config: Config,
    tempDir: string = os.tmpdir(),
  ) {
    this.logger = new BrowserLogger(tempDir);
    this.browserManager = new BrowserManager(config);
    this.browserTools = new BrowserTools(this.browserManager);
  }

  async runTask(
    prompt: string,
    signal: AbortSignal,
    printOutput?: (message: string) => void,
  ) {
    // Use the main CLI model unless explicitly overridden in browser agent settings
    const model =
      this.config.browserAgentSettings?.model ?? this.config.getActiveModel();

    const systemInstruction = `You are an expert browser automation agent (Orchestrator). Your goal is to completely fulfill the user's request.
 
 IMPORTANT: You will receive a fresh accessibility tree snapshot at the start of every turn showing elements with uid values (e.g., uid=87_4 button "Login"). 
 Use these uid values directly with your tools:
 - click(uid="87_4") to click the Login button
 - fill(uid="87_2", value="john") to fill a text field
 - fill_form(elements=[{uid: "87_2", value: "john"}, {uid: "87_3", value: "pass"}]) to fill multiple fields at once
 
 For complex visual interactions (coordinate-based clicks, dragging) OR when you need to identify elements by visual attributes not present in the AX tree (e.g., "click the yellow button", "find the red error message"), use delegate_to_visual_agent with a clear instruction.
 
 CRITICAL: When you have fully completed the user's task, you MUST call the complete_task tool with a summary of what you accomplished. Do NOT just return text - you must explicitly call complete_task to exit the loop.`;

    // Initialize GeminiChat
    const chat = new GeminiChat(this.config, systemInstruction, semanticTools);

    const MAX_ITERATIONS = 20;

    // Consolidated logging: System stuff goes to debugLogger, User stuff goes to printOutput
    let status = 'Connecting to browser...';
    debugLogger.log(status);

    try {
      // Ensure browser connection
      await this.browserManager.ensureConnection();

      // Initialize persistent overlay
      await this.browserTools.updateBorderOverlay({
        active: true,
        capturing: false,
      });

      status = 'Browser connected. Starting task loop...';
      debugLogger.log(status);
    } catch (e) {
      const msg = `Error: Failed to connect to browser: ${e instanceof Error ? e.message : String(e)}`;
      debugLogger.log(msg);
      if (printOutput) printOutput(msg); // Fatal error should be shown
      return msg;
    }

    await this.browserTools.updateBorderOverlay({
      active: true,
      capturing: false,
    });

    // The current input to send to the model (User message parts)
    let currentInputParts: Part[] = [{ text: `Task: ${prompt}` }];
    let iterationCount = 0;
    let taskCompleted = false; // Track if complete_task was called
    let taskSummary = ''; // Store the summary from complete_task

    while (iterationCount < MAX_ITERATIONS) {
      // Check for abort (following local-executor pattern)
      if (signal.aborted) {
        if (printOutput) printOutput('⚠️  Browser task cancelled');
        debugLogger.log('Task cancelled by user');
        break;
      }

      // Capture State
      // Capture State
      // Manual Strategy:
      // We unconditionally capture state at the start of every turn.
      // This ensures the model always has the latest UIDs and reduces complexity.
      let domSnapshot = '';

      status = 'Capturing state...';
      debugLogger.log(status);

      try {
        const client = await this.browserManager.getMcpClient();

        // 1. DOM Snapshot (Semantic Agent uses this)
        const snapResult = await client.callTool('take_snapshot', {
          verbose: false,
        });
        const snapContent = snapResult.content;
        if (snapContent && Array.isArray(snapContent)) {
          domSnapshot = snapContent
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((p: any) => p.type === 'text')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((p: any) => p.text || '')
            .join('');
        }
      } catch (stateError) {
        debugLogger.log(`Warning: State capture failed: ${stateError}`);
      }

      // Check if cancelled after state capture
      if (signal.aborted) {
        if (printOutput) printOutput('⚠️  Browser task cancelled');
        debugLogger.log('Task cancelled during state capture');
        break;
      }

      // Add State to Input Parts
      const stateParts: Part[] = [];
      if (domSnapshot) {
        stateParts.push({
          text: `<accessibility_tree>\n${domSnapshot}\n</accessibility_tree>`,
        });
      }
      // Note: We only send DOM snapshot to the semantic agent.
      // Screenshot is captured on-demand if delegation occurs.

      // Combine previous tool outputs (if any) or initial prompt with state
      // Put semantic state FIRST to avoid completion bias where the model just repeats the tree
      const messageParts = [...stateParts, ...currentInputParts];

      // Prepare for Model Call
      const domSnapshotLen = domSnapshot ? domSnapshot.length : 0;
      status = `[Turn ${iterationCount + 1}/${MAX_ITERATIONS}] Calling model (${messageParts.length} parts, DOM: ${Math.round(domSnapshotLen / 1024)}KB)...`;
      debugLogger.log(status);

      // Call Model with Streaming
      const functionCalls: FunctionCall[] = [];
      let _textResponse = '';
      const promptId = `browser-agent-${Date.now()}`;

      try {
        const stream = await chat.sendMessageStream(
          {
            // We construct the model config key dynamically
            model,
          },
          messageParts,
          promptId,
          signal,
        );

        for await (const event of stream) {
          // Check for cancellation during streaming
          if (signal.aborted) {
            debugLogger.log('Task cancelled during model streaming');
            break;
          }

          if (event.type === StreamEventType.CHUNK) {
            const chunk = event.value;
            const parts = chunk.candidates?.[0]?.content?.parts;

            // Parse Thoughts
            const thoughtPart = parts?.find((p) => p.thought);
            if (thoughtPart) {
              const { subject } = parseThought(thoughtPart.text || '');
              if (subject && printOutput) {
                printOutput(`💭 ${subject}`);
              }
            }

            // Collect text (non-thought)
            const text =
              parts
                ?.filter((p) => !p.thought && p.text)
                .map((p) => p.text)
                .join('') || '';
            if (text) _textResponse += text;

            // Collect Function Calls
            if (chunk.functionCalls) {
              functionCalls.push(...chunk.functionCalls);
              if (printOutput) {
                for (const call of chunk.functionCalls) {
                  if (call.name === 'delegate_to_visual_agent') {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const instruction = (call.args as any)?.instruction;
                    if (instruction) {
                      printOutput(`🤖 Visual Agent: ${instruction}`);
                      continue;
                    }
                  }
                  printOutput(`🔧 Generating tool call: ${call.name}...`);
                }
              }
            }
          }
        }

        // Check if cancelled after streaming
        if (signal.aborted) {
          if (printOutput) printOutput('⚠️  Browser task cancelled');
          debugLogger.log('Task cancelled after model call');
          break;
        }
      } catch (e) {
        const msg = `Error calling model: ${e instanceof Error ? e.message : String(e)}`;
        if (msg.includes('Model stream ended with empty response text')) {
          debugLogger.log(
            'Warning: Caught empty stream error from model. Continuing...',
          );
          // We return, which means the textResponse will be empty, and functionCalls empty.
          // The subsequent check "if (!textResponse && functionCalls.length === 0)"
          // will catch this and handle it gracefully.
        }

        debugLogger.log(msg);
        if (printOutput) printOutput(msg);
        return msg;
      }

      // Update logs with full turn
      const fullHistory = chat.getHistory();
      // fullHistory = [User, Model, User, Model...]
      // partial history is not what we want. We want the latest turn.
      // Usually: Last item is Model Response. Item before that is User Prompt.
      if (fullHistory.length >= 2) {
        const lastModelMessage = fullHistory[fullHistory.length - 1];
        const lastUserMessage = fullHistory[fullHistory.length - 2];

        if (lastModelMessage && lastUserMessage) {
          // Log summary
          void this.logger.logSummary(lastModelMessage);
          // Log full turn (including prompt)
          void this.logger.logFullTurn([lastUserMessage], lastModelMessage);
        }
      }

      // Execute Tools
      if (functionCalls.length > 0) {
        currentInputParts = []; // Reset input parts for the next turn (will hold tool outputs)

        for (const call of functionCalls) {
          // Check if cancelled before each tool execution
          if (signal.aborted) {
            if (printOutput) printOutput('⚠️  Browser task cancelled');
            debugLogger.log('Task cancelled before tool execution');
            break;
          }

          const fnName = call.name;
          const fnArgs = call.args || {};

          if (!fnName) {
            debugLogger.log('❌ Warning: Received function call without name');
            if (printOutput)
              printOutput('❌ Warning: Received function call without name');
            continue;
          }

          if (printOutput)
            printOutput(`🔧 Executing ${fnName}(${JSON.stringify(fnArgs)})`);

          let functionResponse;
          try {
            switch (fnName) {
              case 'navigate':
                functionResponse =
                  (await this.browserTools.navigate(fnArgs['url'] as string))
                    .output || '';
                break;
              case 'click':
                functionResponse =
                  (
                    await this.browserTools.click(
                      fnArgs['uid'] as string,
                      fnArgs['dblClick'] as boolean,
                    )
                  ).output || '';
                break;
              case 'hover':
                functionResponse =
                  (await this.browserTools.hover(fnArgs['uid'] as string))
                    .output || '';
                break;
              case 'fill':
                functionResponse =
                  (
                    await this.browserTools.fill(
                      fnArgs['uid'] as string,
                      fnArgs['value'] as string,
                    )
                  ).output || '';
                break;
              case 'fill_form':
                functionResponse =
                  (
                    await this.browserTools.fillForm(
                      fnArgs['elements'] as Array<{
                        uid: string;
                        value: string;
                      }>,
                    )
                  ).output || '';
                break;
              case 'upload_file':
                functionResponse =
                  (
                    await this.browserTools.uploadFile(
                      fnArgs['uid'] as string,
                      fnArgs['filePath'] as string,
                    )
                  ).output || '';
                break;
              case 'get_element_text':
                functionResponse =
                  (
                    await this.browserTools.getElementText(
                      fnArgs['uid'] as string,
                    )
                  ).output || '';
                break;
              case 'wait_for':
                functionResponse =
                  (await this.browserTools.waitFor(fnArgs['text'] as string))
                    .output || '';
                break;
              case 'handle_dialog':
                functionResponse =
                  (
                    await this.browserTools.handleDialog(
                      fnArgs['action'] as 'accept' | 'dismiss',
                      fnArgs['promptText'] as string,
                    )
                  ).output || '';
                break;
              case 'evaluate_script':
                functionResponse =
                  (
                    await this.browserTools.evaluateScript(
                      fnArgs['function'] as string,
                    )
                  ).output || '';
                break;
              case 'press_key':
                functionResponse =
                  (await this.browserTools.pressKey(fnArgs['key'] as string))
                    .output || '';
                break;
              case 'drag':
                functionResponse =
                  (
                    await this.browserTools.drag(
                      fnArgs['from_uid'] as string,
                      fnArgs['to_uid'] as string,
                    )
                  ).output || '';
                break;
              case 'close_page':
                functionResponse =
                  (await this.browserTools.closePage()).output || '';
                break;
              case 'take_snapshot':
                functionResponse =
                  (
                    await this.browserTools.takeSnapshot(
                      fnArgs['verbose'] as boolean,
                    )
                  ).output || '';
                break;
              case 'scroll_document': {
                const res = await this.browserTools.scrollDocument(
                  fnArgs['direction'] as 'up' | 'down' | 'left' | 'right',
                  fnArgs['amount'] as number,
                );
                functionResponse = res.output || res.error || '';
                break;
              }

              case 'complete_task': {
                taskCompleted = true;
                const summary =
                  (fnArgs['summary'] as string) || 'Task completed';
                taskSummary = summary; // Store summary to return
                functionResponse = summary;
                if (printOutput) printOutput(`✅ ${summary}`);
                break;
              }

              case 'delegate_to_visual_agent': {
                const screen = await this.captureScreenshot();
                const visualRes = await this.runVisualDelegate(
                  (fnArgs['instruction'] as string) || '',
                  screen,
                  printOutput || (() => {}),
                );
                functionResponse = visualRes;
                break;
              }

              default:
                if (
                  (semanticTools[0].functionDeclarations || []).some(
                    (f) => f.name === fnName,
                  )
                ) {
                  // Fallback for any newly added semantic tools not explicitly handled
                  const client = await this.browserManager.getMcpClient();
                  const res = await client.callTool(
                    fnName,
                    fnArgs as unknown as Record<string, unknown>,
                  );
                  functionResponse =
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    res?.content?.map((c: any) => c.text || '').join('\n') ||
                    '';
                } else {
                  // Try browser tools (legacy/visual helpers)
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const res = await (this.browserTools as any)[fnName]?.(
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      ...(Object.values(fnArgs) as any[]),
                    );
                    if (res) {
                      functionResponse = res.output || res.error || '';
                    } else {
                      functionResponse = `Tool ${fnName} not implemented in agent loop.`;
                    }
                  } catch {
                    functionResponse = `Tool ${fnName} not implemented in agent loop.`;
                  }
                }
                break;
            }
          } catch (error) {
            functionResponse = `Error executing ${fnName}: ${error instanceof Error ? error.message : String(error)}`;
          }

          currentInputParts.push({
            functionResponse: {
              name: fnName,
              response: {
                content: [{ type: 'text', text: functionResponse }],
              },
            },
          });
        }

        // Check if task was completed after executing tools
        if (taskCompleted) {
          status = 'Task completed successfully.';
          debugLogger.log(status);
          break;
        }
      } else {
        // No function calls - protocol violation (agent should call complete_task or tools)
        debugLogger.log(
          'Warning: Model stopped calling tools without calling complete_task',
        );
        if (printOutput) {
          printOutput(
            '⚠️  Agent stopped without calling complete_task. Prompting to complete...',
          );
        }

        // Give one more chance to call complete_task
        currentInputParts = [
          {
            text: 'You must call the complete_task tool to finish. If the task is done, call complete_task with a summary. If you cannot complete the task, call complete_task explaining why.',
          },
        ];
      }

      iterationCount++;
    }

    status = 'Task loop finished.';
    debugLogger.log(status);
    return taskSummary || 'Task finished';
  }
  private async runVisualDelegate(
    instruction: string,
    initialScreenshot: string,
    printOutput?: (message: string) => void,
  ): Promise<{ output: string }> {
    const visualModel =
      this.config.browserAgentSettings?.visualModel ??
      'gemini-2.5-computer-use-preview-10-2025';

    // Visual Agent Loop
    const VISUAL_MAX_STEPS = 5;
    const contents: Content[] = [];
    const actionHistory: string[] = [];

    // System instruction for Visual Agent
    const systemInstruction = `You are a Visual Delegate Agent. You have been delegated a specific task: "${instruction}".
You have access to valid screenshot of the current state.
You MUST perform the necessary actions (click_at, type_text_at, drag_and_drop, scroll_document) to fulfill the instruction.
If the element is not visible, use scroll_document to find it.
Return a concise summary of your actions when done.
`;
    // We add the instruction and the initial screenshot
    const initialParts: Part[] = [{ text: systemInstruction }];
    if (initialScreenshot) {
      initialParts.push({
        inlineData: {
          mimeType: 'image/png',
          data: initialScreenshot,
        },
      });
    }

    contents.push({ role: 'user', parts: initialParts });

    for (let i = 0; i < VISUAL_MAX_STEPS; i++) {
      const result = await this.generator.generateContent(
        {
          model: visualModel,
          contents,
          config: {
            tools: visualTools,
          },
        },
        'browser-agent-visual-delegate',
      );

      const response = result.candidates?.[0]?.content;
      if (!response) break;

      // Log visual agent thinking and actions
      if (printOutput) {
        const visualLogParts: string[] = [];
        const textResponse =
          response.parts
            ?.filter((p) => p.text)
            .map((p) => p.text)
            .join('') || '';
        if (textResponse) {
          visualLogParts.push(`  💭 ${textResponse}`);
        }

        const vFunctionCalls =
          response.parts?.filter((p) => 'functionCall' in p) || [];
        if (vFunctionCalls.length > 0) {
          const toolInfo = vFunctionCalls
            .map((p) => {
              const call = p.functionCall!;
              const argsStr = call.args
                ? Object.entries(call.args)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ')
                : '';
              return `  🔧 ${call.name}(${argsStr})`;
            })
            .join('\n');
          visualLogParts.push(
            `[Visual Turn ${i + 1}/${VISUAL_MAX_STEPS}]\n${toolInfo}`,
          );
        }

        if (visualLogParts.length > 0) {
          printOutput(visualLogParts.join('\n'));
        }
      }
      contents.push(response);

      const functionCalls =
        response.parts?.filter((p) => 'functionCall' in p) || [];
      if (functionCalls.length === 0) {
        // Ideally the model explains what it did.
        const text = response.parts?.map((p) => p.text).join('') || 'Done';

        // Invalidate MCP cache to prevent stale UIDs
        try {
          const client = await this.browserManager.getMcpClient();
          await client.callTool('evaluate_script', {
            function: '() => { return true; }',
          });
        } catch (_e) {
          /* ignore */
        }

        return {
          output: `Visual Agent Completed.\nFinal Message: ${text}\nActions Taken:\n${actionHistory.join('\n')}`,
        };
      }

      const functionResponses: Part[] = [];

      for (const part of functionCalls) {
        const call = part.functionCall!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let funcResult: any = {};

        try {
          switch (call.name) {
            case 'click_at':
              funcResult = await this.browserTools.clickAt(
                call.args!['x'] as number,
                call.args!['y'] as number,
              );
              break;
            case 'type_text_at':
              funcResult = await this.browserTools.typeTextAt(
                call.args!['x'] as number,
                call.args!['y'] as number,
                call.args!['text'] as string,
                call.args!['press_enter'] as boolean,
                call.args!['clear_before_typing'] as boolean,
              );
              break;
            case 'drag_and_drop':
              funcResult = await this.browserTools.dragAndDrop(
                call.args!['x'] as number,
                call.args!['y'] as number,
                call.args!['dest_x'] as number,
                call.args!['dest_y'] as number,
              );
              break;
            case 'press_key':
              funcResult = await this.browserTools.pressKey(
                call.args!['key'] as string,
              );
              break;
            case 'scroll_document':
              funcResult = await this.browserTools.scrollDocument(
                call.args!['direction'] as 'up' | 'down' | 'left' | 'right',
                call.args!['amount'] as number,
              );
              break;
            default:
              funcResult = { error: `Unknown visual tool: ${call.name}` };
          }
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          funcResult = { error: message };
        }

        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: funcResult,
          },
        });

        // Track action for history
        actionHistory.push(
          `- ${call.name}(${Object.keys(call.args || {})
            .map((k) => `${k}=${call.args![k]}`)
            .join(', ')}) => ${JSON.stringify(funcResult)}`,
        );
      }

      // Capture new state for next visual turn
      // We need a screenshot!
      let newScreenshot = '';
      try {
        // Use captureScreenshot helper which now defaults to Playwright CSS scale
        newScreenshot = await this.captureScreenshot();
      } catch {
        /* ignore */
      }

      if (newScreenshot) {
        functionResponses.push({
          inlineData: {
            mimeType: 'image/png',
            data: newScreenshot,
          },
        });
      }

      // Function responses are sent as 'user' role in the Gemini API
      contents.push({ role: 'user', parts: functionResponses });
    }

    // Invalidate MCP cache to prevent stale UIDs
    try {
      const client = await this.browserManager.getMcpClient();
      await client.callTool('evaluate_script', {
        function: '() => { return true; }',
      });
    } catch (_e) {
      /* ignore */
    }

    return {
      output: `Visual Agent reached max steps.\nActions Taken:\n${actionHistory.join('\n')}`,
    };
  }

  // Helper to capture screenshot on demand (for visual delegate or fallback)
  private async captureScreenshot(): Promise<string> {
    try {
      const page = await this.browserManager.getPage();
      await page.bringToFront();

      await this.browserTools.updateBorderOverlay({
        active: true,
        capturing: true,
      });

      // TODO: Consider using Playwright's CSS scale option and jpeg quality to reduce file size
      const buffer = await page.screenshot();
      const screenshotBase64 = buffer.toString('base64');

      await this.browserTools.updateBorderOverlay({
        active: true,
        capturing: false,
      });

      return screenshotBase64;
    } catch (e) {
      debugLogger.log(`Warning: Screenshot capture failed: ${e}`);
      return '';
    }
  }
}
