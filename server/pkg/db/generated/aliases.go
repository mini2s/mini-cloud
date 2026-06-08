package db

// Type aliases for backward compatibility with code that uses the non-prefixed names.
// sqlc generates Multica* structs because the database tables have multica_ prefix.
// These aliases allow existing code to continue using db.Issue, db.Attachment, etc.

type Issue = MulticaIssue
type Attachment = MulticaAttachment
type AgentTaskQueue = MulticaAgentTaskQueue
type ChatSession = MulticaChatSession
type Comment = MulticaComment
type Agent = MulticaAgent
type LarkInstallation = MulticaLarkInstallation
type LarkUserBinding = MulticaLarkUserBinding
type Workspace = MulticaWorkspace
type LarkChatSessionBinding = MulticaLarkChatSessionBinding
type LarkOutboundCardMessage = MulticaLarkOutboundCardMessage
type AutopilotTrigger = MulticaAutopilotTrigger
type ChatMessage = MulticaChatMessage
type Member = MulticaMember
type Skill = MulticaSkill
type Squad = MulticaSquad
type WorkflowNodeRun = MulticaWorkflowNodeRun
