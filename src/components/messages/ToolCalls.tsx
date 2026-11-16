import clsx from 'clsx'
import { memo, useMemo } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { approveToolCall } from '../../services/apps/approvals.js'
import type { ToolCallPart } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconChevronRightOutline14 } from '../base/icons.js'
import { VrmStateIcon } from '../vrm/VrmStateIcon.js'
import styles from './ToolCalls.module.css'

const labels: Record<string, TranslationKey> = {
  github_search_repositories: 'githubSearchRepositories',
  github_get_repository: 'githubGetRepository',
  github_list_issues: 'githubListIssues',
  github_get_issue: 'githubGetIssue',
  github_read_file: 'githubReadFile',
  github_create_issue: 'githubCreateIssue',
}

const completedLabels: Record<string, TranslationKey> = {
  github_search_repositories: 'githubRepositoriesSearched',
  github_get_repository: 'githubRepositoryRead',
  github_list_issues: 'githubIssuesListed',
  github_get_issue: 'githubIssueRead',
  github_read_file: 'githubFileRead',
  github_create_issue: 'githubIssueCreated',
}

const statuses: Record<ToolCallPart['status'], TranslationKey> = {
  pending: 'appToolPending',
  approval: 'appToolAwaitingApproval',
  running: 'appToolRunning',
  done: 'appToolDone',
  error: 'appToolError',
  cancelled: 'appToolCancelled',
}

const targetText = (input: Record<string, unknown>) => {
  if (typeof input.query === 'string') {
    return input.query
  }
  const repository = [input.owner, input.repo]
    .filter((value) => typeof value === 'string')
    .join('/')
  if (typeof input.path === 'string') {
    return `${repository}/${input.path}`
  }
  if (typeof input.issue_number === 'number') {
    return `${repository} #${input.issue_number}`
  }
  return typeof input.title === 'string' ? `${repository} · ${input.title}` : repository
}

export const ToolCallContent = memo(function ToolCallContent({
  call,
  sessionId,
  messageId,
  streaming,
}: {
  call: ToolCallPart
  sessionId: string
  messageId: string
  streaming: boolean
}) {
  const t = useTranslate()
  const input =
    typeof call.input === 'object' && call.input !== null && !Array.isArray(call.input)
      ? (call.input as Record<string, unknown>)
      : {}
  const waiting = streaming && call.status === 'approval'
  const active = call.status === 'pending' || call.status === 'running'
  const target = targetText(input)
  const label =
    call.status === 'done' && Object.hasOwn(completedLabels, call.name)
      ? t(completedLabels[call.name])
      : Object.hasOwn(labels, call.name)
        ? t(labels[call.name])
        : call.name
  const result = useMemo(() => {
    const content = call.result?.content ?? ''
    try {
      return JSON.stringify(JSON.parse(content) as unknown, null, 2)
    } catch {
      return content
    }
  }, [call.result?.content])

  return (
    <div className={styles.call}>
      <details className={styles.details}>
        <summary
          className={clsx(
            styles.summary,
            active && styles.active,
            call.status === 'error' && styles.error
          )}
          title={t('appToolDetails')}
        >
          {call.status === 'done' ? (
            <VrmStateIcon state="done" className={styles.doneIcon} />
          ) : null}
          <span className={styles.label}>{label}</span>
          <span className={styles.chevron} aria-hidden="true">
            <IconChevronRightOutline14 />
          </span>
          {target ? (
            <span className={styles.target} title={target}>
              {target}
            </span>
          ) : null}
          {call.status !== 'done' ? (
            <span className={styles.status} role="status">
              {t(statuses[call.status])}
            </span>
          ) : null}
        </summary>
        <div className={styles.payload}>
          <div className={styles.caption}>{t('appToolArguments')}</div>
          <pre tabIndex={0} aria-label={t('appToolArguments')}>
            {JSON.stringify(call.input, null, 2)}
          </pre>
          {call.result ? (
            <>
              <div className={styles.caption}>{t('appToolResult')}</div>
              <pre
                tabIndex={0}
                aria-label={t('appToolResult')}
                className={call.result.is_error ? styles.error : undefined}
              >
                {result}
              </pre>
            </>
          ) : null}
        </div>
      </details>
      {waiting ? (
        <div className={styles.approval}>
          <VrmStateIcon state="waiting" className={styles.waitingIcon} />
          <p>{t('appToolApprovalDescription')}</p>
          <dl>
            <dt>{t('appToolRepository')}</dt>
            <dd>
              {String(input.owner ?? '')}/{String(input.repo ?? '')}
            </dd>
            <dt>{t('appToolTitle')}</dt>
            <dd>{String(input.title ?? '')}</dd>
            <dt>{t('appToolBody')}</dt>
            <dd>
              <pre>{String(input.body ?? '')}</pre>
            </dd>
          </dl>
          <div className={styles.actions}>
            <Button
              size="m"
              variant="outlined"
              onClick={() => approveToolCall(sessionId, messageId, call.id, false)}
            >
              {t('appToolReject')}
            </Button>
            <Button size="m" onClick={() => approveToolCall(sessionId, messageId, call.id, true)}>
              {t('appToolApprove')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
})
