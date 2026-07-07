CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`hostname` text NOT NULL,
	`version` text NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`last_heartbeat` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_response_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`cache_key` text NOT NULL,
	`response_text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_response_cache_cache_key_unique` ON `ai_response_cache` (`cache_key`);--> statement-breakpoint
CREATE TABLE `event_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`agent_id` text,
	`event_type` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`path` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`claude_session_id` text,
	`telegram_thread_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_path_unique` ON `projects` (`path`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`file_path` text NOT NULL,
	`raw_content` text NOT NULL,
	`summary` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `statistics` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`metric_name` text NOT NULL,
	`metric_value` text NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`report_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `telegram_history` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`chat_id` text NOT NULL,
	`direction` text NOT NULL,
	`message_type` text NOT NULL,
	`content` text NOT NULL,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `todos` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`content` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
