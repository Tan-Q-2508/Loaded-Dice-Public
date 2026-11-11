CREATE TYPE "public"."connection_status" AS ENUM('CONNECTED', 'DISCONNECTED', 'RECONNECTING');--> statement-breakpoint
CREATE TYPE "public"."room_status" AS ENUM('LOBBY', 'IN_PROGRESS', 'GAME_OVER', 'FROZEN', 'CORRUPTED', 'ABANDONED', 'ARCHIVED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "game_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"state_version" integer NOT NULL,
	"action_uuid" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"session_id" uuid,
	"display_name" text NOT NULL,
	"connection_status" "connection_status" DEFAULT 'CONNECTED' NOT NULL,
	"seat_order" integer NOT NULL,
	"is_alive" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_code" text NOT NULL,
	"host_player_id" uuid,
	"status" "room_status" DEFAULT 'LOBBY' NOT NULL,
	"rebalance_enabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{"minPlayers":5,"maxPlayers":10}'::jsonb NOT NULL,
	"frozen_reason" text,
	"incident_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"socket_id" text,
	"auth_token" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_events_room_seq_uidx" ON "game_events" USING btree ("room_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "game_events_room_action_uuid_uidx" ON "game_events" USING btree ("room_id","action_uuid") WHERE "game_events"."action_uuid" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "game_events_room_seq_idx" ON "game_events" USING btree ("room_id","seq");--> statement-breakpoint
CREATE INDEX "players_room_id_idx" ON "players" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_room_seat_uidx" ON "players" USING btree ("room_id","seat_order");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_room_code_uidx" ON "rooms" USING btree ("room_code");--> statement-breakpoint
CREATE INDEX "rooms_status_idx" ON "rooms" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_auth_token_uidx" ON "sessions" USING btree ("auth_token");--> statement-breakpoint
CREATE INDEX "sessions_player_id_idx" ON "sessions" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_room_version_uidx" ON "snapshots" USING btree ("room_id","version");--> statement-breakpoint
CREATE INDEX "snapshots_room_version_desc_idx" ON "snapshots" USING btree ("room_id","version");