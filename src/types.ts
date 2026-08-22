export type KnowledgeLayer = {
  id: string;
  purpose: string;
  paths: string[];
  profiles?: string[];
  required?: boolean;
};

export type Profile = {
  githubActors: { users: string[]; teams: string[] };
  authority: string[];
  responsibilities: string[];
  exclusions: string[];
  areas: string[];
  knowledge?: string[];
  instructions?: string[];
  acceptance?: string[];
};

export type ChollaConfig = {
  schemaVersion: 1;
  project: { name: string; repository?: string };
  knowledge: { layers: KnowledgeLayer[] };
  profiles: Record<string, Profile>;
  github: {
    repository?: string;
    activeMilestoneMarker: string;
    taxonomy: { types: string[]; priorities: string[] };
    labels: {
      ready: string;
      inProgress: string;
      blocked: string;
      needsDecision: string;
      handoffRequired: string;
      humanRequired: string;
      accepted: string;
      profilePrefix: string;
      areaPrefix: string;
      typePrefix: string;
      priorityPrefix: string;
    };
  };
  policy: {
    acceptanceProfile?: string;
    requireIndependentAcceptance: boolean;
    claimTtlHours: number;
  };
};

export type Issue = {
  number: number;
  title: string;
  url: string;
  body: string;
  labels: { name: string }[];
  assignees: { login: string }[];
  milestone: { title: string; description?: string | null } | null;
  updatedAt: string;
  comments?: { body: string; createdAt: string; author: { login: string } | null }[];
};

export type Milestone = {
  number: number;
  title: string;
  description?: string | null;
  state: string;
};
