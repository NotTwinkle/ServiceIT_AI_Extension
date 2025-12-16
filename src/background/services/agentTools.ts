/**
 * Agent Tools
 * 
 * Implements tool use / function calling pattern for the agentic AI system.
 * This allows the AI to dynamically search Ivanti documentation and API info
 * instead of relying on hardcoded knowledge.
 * 
 * Based on 2024 best practices:
 * - Tool use / Function calling (OpenAI, Anthropic, Gemini)
 * - ReAct pattern (Reasoning + Acting)
 * - RAG (Retrieval Augmented Generation)
 * 
 * Tools available to the agent:
 * 1. searchIvantiDocumentation - Search Ivanti docs for specific topics
 * 2. searchRequestOfferingInfo - Get detailed info about a specific offering
 * 3. searchFieldsetStructure - Understand fieldset structure and field types
 */

import { getRelevantDocumentation, formatDocumentationForContext } from './ivantiDocumentation';
import { fetchRequestOfferingFieldset, normalizeRequestOfferingFieldset } from './ivantiDataService';
import { fetchRequestOfferings } from './ivantiDataService';

export interface AgentTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      required?: boolean;
    }>;
    required?: string[];
  };
}

export interface ToolCall {
  tool: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Available tools for the agent
 */
export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'searchIvantiDocumentation',
    description: 'Search Ivanti REST API documentation and best practices. Use this when you need to understand how Ivanti APIs work, what endpoints exist, or how to structure requests. Examples: "How do I create a service request?", "What fields are required for request offerings?", "How do validation lists work in Ivanti?"',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for in the documentation (e.g., "service request creation", "request offering fieldsets", "validation lists")',
          required: true
        },
        category: {
          type: 'string',
          description: 'Optional: Filter by category (incidents, service-requests, api, workflows, users, general)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'searchRequestOfferingInfo',
    description: 'Get detailed information about a specific request offering, including its fieldset structure, required fields, field types, and dropdown options. Use this when you need to understand what fields an offering has before creating a service request.',
    parameters: {
      type: 'object',
      properties: {
        offeringName: {
          type: 'string',
          description: 'The exact name of the request offering (e.g., "Computer Request from Product Catalog", "Request for Hardware")',
          required: true
        },
        includeFieldDetails: {
          type: 'boolean',
          description: 'Whether to include detailed field information (types, options, required status). Default: true'
        }
      },
      required: ['offeringName']
    }
  },
  {
    name: 'searchFieldsetStructure',
    description: 'Understand the structure of a fieldset for a request offering, including how fields are organized, what types they are, and where to find them in the API response. Use this when you need to know how to parse or work with fieldset data.',
    parameters: {
      type: 'object',
      properties: {
        subscriptionId: {
          type: 'string',
          description: 'The subscription ID of the request offering',
          required: true
        },
        fieldName: {
          type: 'string',
          description: 'Optional: Specific field name to get details about'
        }
      },
      required: ['subscriptionId']
    }
  }
];

/**
 * Execute a tool call
 */
export async function executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
  try {
    switch (toolCall.tool) {
      case 'searchIvantiDocumentation':
        return await executeSearchDocumentation(toolCall.arguments as { query: string; category?: string });
      
      case 'searchRequestOfferingInfo':
        return await executeSearchOfferingInfo(toolCall.arguments as { offeringName: string; includeFieldDetails?: boolean });
      
      case 'searchFieldsetStructure':
        return await executeSearchFieldsetStructure(toolCall.arguments as { subscriptionId: string; fieldName?: string });
      
      default:
        return {
          success: false,
          error: `Unknown tool: ${toolCall.tool}`
        };
    }
  } catch (error: any) {
    console.error(`[Agent Tools] ❌ Error executing tool ${toolCall.tool}:`, error);
    return {
      success: false,
      error: error.message || 'Unknown error'
    };
  }
}

/**
 * Tool: Search Ivanti Documentation
 */
async function executeSearchDocumentation(args: { query: string; category?: string }): Promise<ToolResult> {
  console.log('[Agent Tools] 🔍 Searching Ivanti documentation:', args.query);
  
  try {
    // Build query with category filter if provided
    const query = args.category ? `${args.query} ${args.category}` : args.query;
    const docs = await getRelevantDocumentation(query);
    // Filter by category if specified
    const filteredDocs = args.category 
      ? docs.filter(doc => doc.category === args.category)
      : docs;
    const formatted = formatDocumentationForContext(filteredDocs);
    
    return {
      success: true,
      data: {
        query: args.query,
        results: formatted,
        sectionsFound: docs.length
      }
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to search documentation: ${error.message}`
    };
  }
}

/**
 * Tool: Search Request Offering Info
 */
async function executeSearchOfferingInfo(args: { offeringName: string; includeFieldDetails?: boolean }): Promise<ToolResult> {
  console.log('[Agent Tools] 🔍 Getting offering info:', args.offeringName);
  
  try {
    const offerings = await fetchRequestOfferings();
    const offering = offerings.find((o: any) => {
      const name = o.strName || o.Name || '';
      return name.toLowerCase() === args.offeringName.toLowerCase();
    });
    
    if (!offering) {
      return {
        success: false,
        error: `Request offering "${args.offeringName}" not found`
      };
    }
    
    const subscriptionId = offering.strSubscriptionId || offering.SubscriptionId || '';
    
    let fieldsetInfo = null;
    if (args.includeFieldDetails !== false) {
      try {
        // ✅ Pass offering object to fetch correct template structure
        const rawFieldset = await fetchRequestOfferingFieldset(subscriptionId, offering);
        if (rawFieldset) {
          const normalized = normalizeRequestOfferingFieldset(rawFieldset, offering);
          
          fieldsetInfo = {
            totalFields: normalized.fields.length,
            requiredFields: normalized.fields.filter(f => f.required).map(f => ({
              name: f.name,
              label: f.label,
              type: f.type,
              options: f.type === 'combo' || f.type === 'dropdown' 
                ? (f.options?.slice(0, 10).map(opt => opt.label) || [])
                : undefined
            })),
            optionalFields: normalized.fields.filter(f => !f.required).map(f => ({
              name: f.name,
              label: f.label,
              type: f.type
            })),
            fieldTypes: {
              text: normalized.fields.filter(f => f.type === 'text').length,
              combo: normalized.fields.filter(f => f.type === 'combo').length,
              dropdown: normalized.fields.filter(f => f.type === 'dropdown').length,
              date: normalized.fields.filter(f => f.type === 'date').length,
              boolean: normalized.fields.filter(f => f.type === 'boolean').length
            }
          };
        }
      } catch (error: any) {
        console.warn('[Agent Tools] ⚠️ Could not fetch fieldset details:', error);
      }
    }
    
    return {
      success: true,
      data: {
        offeringName: offering.strName || offering.Name,
        subscriptionId,
        category: offering.strCategory || offering.Category,
        description: offering.strDescription || offering.Description,
        fieldset: fieldsetInfo
      }
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to get offering info: ${error.message}`
    };
  }
}

/**
 * Tool: Search Fieldset Structure
 */
async function executeSearchFieldsetStructure(args: { subscriptionId: string; fieldName?: string }): Promise<ToolResult> {
  console.log('[Agent Tools] 🔍 Getting fieldset structure:', args.subscriptionId);
  
  try {
    const offerings = await fetchRequestOfferings();
    const offering = offerings.find((o: any) => {
      const id = o.strSubscriptionId || o.SubscriptionId || '';
      return id === args.subscriptionId;
    });
    
    if (!offering) {
      return {
        success: false,
        error: `Request offering with subscriptionId "${args.subscriptionId}" not found`
      };
    }
    
    // ✅ Pass offering object to fetch correct template structure
    const rawFieldset = await fetchRequestOfferingFieldset(args.subscriptionId, offering);
    if (!rawFieldset) {
      return {
        success: false,
        error: 'Fieldset not found for this offering'
      };
    }
    
    const normalized = normalizeRequestOfferingFieldset(rawFieldset, offering);
    
    // If specific field requested, return just that field
    if (args.fieldName && args.fieldName.trim() !== '') {
      const fieldNameLower = args.fieldName.toLowerCase();
      const field = normalized.fields.find(f => 
        f.name === args.fieldName || f.label?.toLowerCase() === fieldNameLower
      );
      
      if (!field) {
        return {
          success: false,
          error: `Field "${args.fieldName}" not found in fieldset`
        };
      }
      
      return {
        success: true,
        data: {
          field: {
            name: field.name,
            label: field.label,
            type: field.type,
            required: field.required,
            defaultValue: field.defaultValue,
            options: field.options?.map(opt => ({
              label: opt.label,
              value: opt.value,
              recId: opt.recId
            }))
          },
          fieldsetStructure: {
            location: 'lstParamCategories[0].lstParameters',
            totalFields: normalized.fields.length
          }
        }
      };
    }
    
    // Return full structure
    return {
      success: true,
      data: {
        structure: {
          location: 'lstParamCategories[0].lstParameters',
          totalFields: normalized.fields.length,
          fields: normalized.fields.map(f => ({
            name: f.name,
            label: f.label,
            type: f.type,
            required: f.required,
            hasOptions: !!(f.options && f.options.length > 0),
            optionsCount: f.options?.length || 0
          }))
        },
        apiStructure: {
          rawFieldsetKeys: Object.keys(rawFieldset),
          hasLstParameters: !!(rawFieldset as any).lstParameters,
          hasLstParamCategories: !!(rawFieldset as any).lstParamCategories,
          paramCategoriesCount: (rawFieldset as any).lstParamCategories?.length || 0
        }
      }
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to get fieldset structure: ${error.message}`
    };
  }
}

/**
 * Build a system message that teaches the AI about available tools
 */
export function buildToolSystemMessage(): string {
  return `[AGENT TOOLS AVAILABLE]

You have access to tools that let you search Ivanti documentation and API information dynamically.
Instead of guessing or using hardcoded knowledge, USE THESE TOOLS to get accurate, up-to-date information.

Available Tools:
${AGENT_TOOLS.map(tool => `
**${tool.name}**
${tool.description}

Parameters:
${Object.entries(tool.parameters.properties).map(([key, prop]) => 
  `- ${key} (${prop.type}): ${prop.description}${prop.required ? ' [REQUIRED]' : ' [OPTIONAL]'}`
).join('\n')}
`).join('\n')}

[WHEN TO USE TOOLS]

1. **When you don't know the structure of a request offering:**
   → Use: searchRequestOfferingInfo(offeringName: "Computer Request from Product Catalog")
   → This tells you what fields exist, which are required, what types they are, and dropdown options

2. **When you need to understand Ivanti API behavior:**
   → Use: searchIvantiDocumentation(query: "service request creation REST API")
   → This gives you official documentation on how APIs work

3. **When you need to understand fieldset structure:**
   → Use: searchFieldsetStructure(subscriptionId: "...")
   → This tells you where fields are located in the API response (lstParamCategories, etc.)

[CRITICAL RULE]
- NEVER guess or assume field structures
- ALWAYS use tools to get accurate information
- If you're unsure about an offering, search for it first before proceeding

[TOOL CALLING FORMAT]
When you need to use a tool, respond with:
\`\`\`tool_call
{
  "tool": "tool_name",
  "arguments": {
    "param1": "value1",
    "param2": "value2"
  }
}
\`\`\`

The system will execute the tool and provide you with the results.`;
}
