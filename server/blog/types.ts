export type PostStatus = 'published' | 'draft';

export interface PostMeta {
  title: string;
  slug: string;
  summary: string;
  publishedAt: string;
  updatedAt?: string;
  tags?: string[];
  status: PostStatus;
  heroImage?: string;
  mediumUrl?: string;
}

export interface Post {
  meta: PostMeta;
  html: string;
  dir: string;
}
