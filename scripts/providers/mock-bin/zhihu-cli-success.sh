#!/usr/bin/env sh

for arg in "$@"; do
  if [ "$arg" = "--question-id" ]; then
    printf '{"id":"zhihu-cli-answer-001","url":"https://mock.zhihu.com/p/cli-answer"}\n'
    exit 0
  fi
done

printf '{"id":"zhihu-cli-article-001","url":"https://mock.zhihu.com/p/cli-article"}\n'
