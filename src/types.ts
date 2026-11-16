export interface ApiBlock {
  tag: string;
  text: string;
}

export interface ApiArticle {
  title: string;
  lang: string;
  blocks: ApiBlock[];
  url: string;
}

export interface SentenceRef {
  i: number;
  text: string;
}

export interface ReadBlock {
  tag: string;
  first: number;
  last: number;
  sentences: SentenceRef[];
}

export interface ReadArticle {
  blocks: ReadBlock[];
  sentences: string[];
}

export interface WordRange {
  start: number;
  end: number;
}
