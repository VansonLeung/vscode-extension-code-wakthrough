export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List files and directories at a given path relative to the workspace root. " +
        "Returns file names with indicators: trailing / for directories, file sizes, and line counts for text files. " +
        "Use this first to understand the project structure before reading specific files.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              'Directory path relative to workspace root. Use "." for root.',
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a file. Returns the full file content for small files, " +
        "or a specified line range for large files. Line numbers are 1-indexed.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to workspace root.",
          },
          start_line: {
            type: "string",
            description:
              "Start line (1-indexed). Omit to read from beginning.",
          },
          end_line: {
            type: "string",
            description: "End line (1-indexed). Omit to read to end.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search",
      description:
        "Search file contents for a text pattern (case-insensitive substring match). " +
        "Returns matching file paths with line numbers and matching line content. " +
        "Use this to find where specific functions, classes, or patterns are used.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Text pattern to search for.",
          },
          include: {
            type: "string",
            description:
              'Glob pattern to filter files. Example: "*.ts", "src/**/*.py". Omit to search all files.',
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_symbols",
      description:
        "Get all symbols (functions, classes, methods, variables, interfaces) defined in a file. " +
        "Returns symbol names with their kind and line range. " +
        "Use this to understand the API surface of a file without reading all its code.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to workspace root.",
          },
        },
        required: ["path"],
      },
    },
  },
];

export const TOOL_NAMES = TOOL_DEFINITIONS.map((t) => t.function.name);
