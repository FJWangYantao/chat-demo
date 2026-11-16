import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import type { CatalogModel } from '../../services/providers.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { IconCheckOutline16, IconChevronDownOutline14 } from '../base/icons.js'
import styles from './MagpieConnection.module.css'
import { MagpieProviderIcon } from './MagpieProviderIcon.js'

const providerOf = (id: string) => id.split('/')[0] || 'other'

type ProviderChoice = {
  id: string | null
  label: string
  icon: string
  count: number
}

export const MagpieModelPicker = ({
  id,
  models,
  value,
  invalid,
  warningId,
  onChange,
}: {
  id: string
  models: CatalogModel[]
  value: string
  invalid: boolean
  warningId?: string
  onChange: (value: string) => void
}) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const modelListRef = useRef<HTMLDivElement>(null)
  const activeOption = useRef<HTMLDivElement>(null)
  const providerRefs = useRef<(HTMLButtonElement | null)[]>([])
  const providers = useMemo(() => {
    const counts = new Map<string, number>()
    for (const model of models) {
      const provider = providerOf(model.id)
      counts.set(provider, (counts.get(provider) ?? 0) + 1)
    }
    return counts
  }, [models])
  const providerChoices = useMemo<ProviderChoice[]>(
    () => [
      { id: null, label: t('magpieAllModels'), icon: 'auto', count: models.length },
      ...Array.from(providers, ([provider, count]) => ({
        id: provider,
        label: provider === 'other' ? t('magpieOtherModels') : provider,
        icon: provider,
        count,
      })),
    ],
    [models.length, providers, t]
  )
  const activeProviderIndex = Math.max(
    0,
    providerChoices.findIndex((choice) => choice.id === selectedProvider)
  )
  const providerModels = useMemo(
    () =>
      selectedProvider === null
        ? models
        : models.filter((model) => providerOf(model.id) === selectedProvider),
    [models, selectedProvider]
  )
  const filteredModels = useMemo(() => {
    const query = search.trim().toLowerCase()
    return query
      ? providerModels.filter(
          (item) => item.id.toLowerCase().includes(query) || item.name.toLowerCase().includes(query)
        )
      : providerModels
  }, [providerModels, search])
  const groups = useMemo(() => {
    const grouped = new Map<string, CatalogModel[]>()
    for (const model of filteredModels) {
      const provider = providerOf(model.id)
      const items = grouped.get(provider)
      if (items) {
        items.push(model)
      } else {
        grouped.set(provider, [model])
      }
    }
    return Array.from(grouped, ([provider, items]) => ({ provider, items }))
  }, [filteredModels])
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLDivElement, HTMLDivElement>(
    open,
    { maxHeight: 216, minSpace: 120, measureKey: `${search}:${selectedProvider ?? ''}` }
  )
  useDismiss(
    open,
    [anchorRef, floatingRef],
    () => {
      if (floatingRef.current?.contains(document.activeElement)) {
        inputRef.current?.focus()
      }
      setOpen(false)
    },
    { captureEscape: true }
  )

  const currentIndex = Math.min(activeIndex, filteredModels.length - 1)
  const currentModel = filteredModels[currentIndex]
  const activeId = open && currentModel ? `${id}-option-${currentIndex}` : undefined
  const openModels = (allProviders = false) => {
    const visibleModels = allProviders ? models : providerModels
    setSearch('')
    setActiveIndex(
      Math.max(
        0,
        visibleModels.findIndex((item) => item.id === value)
      )
    )
    setOpen(true)
  }
  const selectProvider = (provider: string | null) => {
    setSelectedProvider(provider)
    setSearch('')
    setActiveIndex(0)
  }
  const choose = (model: CatalogModel) => {
    onChange(model.id)
    setOpen(false)
  }

  useLayoutEffect(() => {
    const list = modelListRef.current
    const option = activeOption.current
    if (!open || !list || !option) {
      return
    }
    const listRect = list.getBoundingClientRect()
    const optionRect = option.getBoundingClientRect()
    if (optionRect.top < listRect.top) {
      list.scrollTop -= listRect.top - optionRect.top
    } else if (optionRect.bottom > listRect.bottom) {
      list.scrollTop += optionRect.bottom - listRect.bottom
    }
  }, [activeId, open, search, selectedProvider])

  return (
    <>
      <div className={styles.modelLabel}>
        <label id={`${id}-model-label`} htmlFor={`${id}-model`}>
          {t('magpieModel')}
        </label>
        <span className={styles.modelMeta}>
          <span id={`${id}-model-count`}>{t('magpieModelCount', { count: models.length })}</span>
          <button
            type="button"
            className={styles.showAll}
            aria-expanded={open}
            aria-controls={`${id}-models`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              if (open) {
                setOpen(false)
              } else {
                setSelectedProvider(null)
                inputRef.current?.focus()
                openModels(true)
              }
            }}
          >
            {t(open ? 'magpieHideModels' : 'magpieShowAllModels')}
          </button>
        </span>
      </div>
      <p id={`${id}-model-hint`}>{t('magpieModelHint')}</p>
      <div ref={anchorRef} className={styles.combo}>
        <input
          ref={inputRef}
          id={`${id}-model`}
          name="magpie-model"
          role="combobox"
          value={open ? search : value}
          placeholder={t('magpieModelSearchPlaceholder')}
          required
          maxLength={512}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-models`}
          aria-activedescendant={activeId}
          aria-invalid={invalid}
          aria-describedby={`${id}-model-hint ${id}-model-count${warningId ? ` ${warningId}` : ''}${invalid ? ` ${id}-form-error` : ''}`}
          onFocus={() => {
            if (!open) {
              openModels()
            }
          }}
          onBlur={(event) => {
            if (
              event.relatedTarget instanceof Node &&
              floatingRef.current?.contains(event.relatedTarget)
            ) {
              return
            }
            setOpen(false)
          }}
          onClick={() => {
            if (!open) {
              openModels()
            }
          }}
          onChange={(event) => {
            setSearch(event.target.value)
            setActiveIndex(0)
            setOpen(true)
            onChange(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (!open) {
                openModels()
              } else if (filteredModels.length) {
                const direction = event.key === 'ArrowDown' ? 1 : -1
                setActiveIndex(
                  (currentIndex + direction + filteredModels.length) % filteredModels.length
                )
              }
            } else if (event.key === 'Enter' && open && currentModel) {
              event.preventDefault()
              choose(currentModel)
            } else if (event.key === 'Enter' && open) {
              setOpen(false)
            } else if (event.key === 'Tab' && open && !event.shiftKey) {
              event.preventDefault()
              providerRefs.current[activeProviderIndex]?.focus()
              providerRefs.current[activeProviderIndex]?.scrollIntoView({ block: 'nearest' })
            } else if (event.key === 'Tab') {
              setOpen(false)
            }
          }}
        />
        <span className={styles.chevron} aria-hidden="true">
          <IconChevronDownOutline14 />
        </span>
      </div>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.menu}
              style={{
                ...(position ?? {}),
                blockSize: position?.maxHeight,
                inlineSize: Math.min(620, window.innerWidth - 16),
              }}
            >
              <div className={styles.providerPane}>
                <div className={styles.sidebarTitle} id={`${id}-providers-label`}>
                  {t('magpieProviders')}
                </div>
                <div
                  className={styles.providerTabs}
                  role="tablist"
                  aria-orientation="vertical"
                  aria-labelledby={`${id}-providers-label`}
                >
                  {providerChoices.map((choice, index) => (
                    <button
                      key={choice.id ?? 'all'}
                      ref={(button) => {
                        providerRefs.current[index] = button
                      }}
                      id={`${id}-provider-${index}`}
                      type="button"
                      className={styles.providerButton}
                      role="tab"
                      aria-selected={choice.id === selectedProvider}
                      aria-controls={`${id}-models-panel`}
                      tabIndex={index === activeProviderIndex ? 0 : -1}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => selectProvider(choice.id)}
                      onKeyDown={(event) => {
                        if (event.altKey || event.ctrlKey || event.metaKey) {
                          return
                        }
                        let next = -1
                        if (event.key === 'ArrowDown') {
                          next = (index + 1) % providerChoices.length
                        } else if (event.key === 'ArrowUp') {
                          next = (index - 1 + providerChoices.length) % providerChoices.length
                        } else if (event.key === 'Home') {
                          next = 0
                        } else if (event.key === 'End') {
                          next = providerChoices.length - 1
                        }
                        if (next >= 0) {
                          event.preventDefault()
                          selectProvider(providerChoices[next].id)
                          providerRefs.current[next]?.focus()
                          providerRefs.current[next]?.scrollIntoView({ block: 'nearest' })
                        } else if (event.key === 'ArrowRight') {
                          event.preventDefault()
                          inputRef.current?.focus()
                        } else if (event.key === 'Tab') {
                          event.preventDefault()
                          setOpen(false)
                          inputRef.current?.focus()
                        }
                      }}
                    >
                      <MagpieProviderIcon provider={choice.icon} />
                      <span className={styles.providerName}>{choice.label}</span>
                      <span className={styles.providerCount}>{choice.count}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div
                id={`${id}-models-panel`}
                className={styles.modelsPanel}
                role="tabpanel"
                aria-labelledby={`${id}-provider-${activeProviderIndex}`}
              >
                <div
                  ref={modelListRef}
                  id={`${id}-models`}
                  className={styles.modelsList}
                  role="listbox"
                  aria-labelledby={`${id}-model-label`}
                >
                  {groups.length ? (
                    groups.map((group, groupIndex) => (
                      <div
                        key={group.provider}
                        className={styles.group}
                        role="group"
                        aria-labelledby={`${id}-group-${groupIndex}`}
                      >
                        <div className={styles.groupLabel} id={`${id}-group-${groupIndex}`}>
                          <span>
                            {group.provider === 'other' ? t('magpieOtherModels') : group.provider}
                          </span>
                          <span>{group.items.length}</span>
                        </div>
                        {group.items.map((item) => {
                          const index = filteredModels.indexOf(item)
                          return (
                            <div
                              key={item.id}
                              ref={index === currentIndex ? activeOption : undefined}
                              id={`${id}-option-${index}`}
                              className={styles.option}
                              role="option"
                              aria-selected={item.id === value}
                              data-active={index === currentIndex}
                              onPointerDown={(event) => event.preventDefault()}
                              onPointerMove={() => setActiveIndex(index)}
                              onClick={() => choose(item)}
                            >
                              <span className={styles.optionText}>
                                <span className={styles.optionId}>{item.id}</span>
                                {item.name !== item.id ? (
                                  <span className={styles.optionName}>{item.name}</span>
                                ) : null}
                              </span>
                              {item.id === value ? (
                                <span className={styles.check} aria-hidden="true">
                                  <IconCheckOutline16 />
                                </span>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    ))
                  ) : (
                    <div className={styles.noResults}>{t('magpieNoMatchingModels')}</div>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
