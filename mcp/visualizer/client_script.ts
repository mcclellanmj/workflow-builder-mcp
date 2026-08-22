/**
 * Interactive Cytoscape + Dagre Client Script.
 * Zero external CDN dependencies (bundled directly via vendor_bundle).
 */

export function getVisualizerClientScript(): string {
  return `
    (function() {
      // Safe HTML escaping
      function escapeHtml(text) {
        if (text == null) return '';
        return String(text)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      // Parse payload
      const rawData = JSON.parse(document.getElementById('workflow-bundle').textContent);
      const workflows = rawData.workflows;
      const primaryWfId = rawData.primaryWorkflowId;

      // App state
      let currentWorkflowId = primaryWfId;
      let breadcrumbsStack = [primaryWfId];
      let cy = null;
      let layoutDirection = 'TB';
      let selectedNodeData = null;
      let nodesLocked = true;
      let autoRefreshActive = true;

      const STATUS_ICONS = {
        completed: '✅',
        running: '🔄',
        pending: '⏳',
        failed: '❌',
        skipped: '⏭️'
      };

      const STATUS_COLORS = {
        completed: '#10b981',
        running: '#3b82f6',
        pending: '#f59e0b',
        failed: '#ef4444',
        skipped: '#64748b'
      };

      const NODE_SHAPES = {
        start: 'round-rectangle',
        end: 'round-rectangle',
        decision: 'diamond',
        user_interaction: 'hexagon',
        subworkflow: 'round-rectangle',
        step: 'round-rectangle'
      };

      function showToast(msg) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
      }

      function updateBreadcrumbBar() {
        const bar = document.getElementById('breadcrumb-bar');
        if (!bar) return;
        bar.innerHTML = '';

        breadcrumbsStack.forEach((wfId, idx) => {
          const wfData = workflows[wfId];
          const isLast = idx === breadcrumbsStack.length - 1;
          const isRoot = idx === 0;

          if (idx > 0) {
            const separator = document.createElement('span');
            separator.textContent = '>';
            bar.appendChild(separator);
          }

          const item = document.createElement('a');
          item.className = 'breadcrumb-item' + (isLast ? ' active' : '');
          item.innerHTML = (isRoot ? '🏠 ' : '📦 ') + (wfData ? escapeHtml(wfData.workflow.name) : wfId);

          if (!isLast) {
            item.href = '#';
            item.onclick = (e) => {
              e.preventDefault();
              navigateToWorkflowIndex(idx);
            };
          }
          bar.appendChild(item);
        });

        const curWf = workflows[currentWorkflowId]?.workflow;
        if (curWf) {
          const titleEl = document.getElementById('display-title');
          if (titleEl) titleEl.textContent = curWf.name;
          const isSub = breadcrumbsStack.length > 1 || curWf.intendedForIndependentRun === false;
          const badge = document.getElementById('display-badge');
          if (badge) {
            badge.textContent = isSub ? 'Sub-workflow' : 'Standalone';
            badge.style.borderColor = isSub ? '#a855f7' : '#38bdf8';
            badge.style.color = isSub ? '#c084fc' : '#38bdf8';
          }
        }
      }

      function navigateToWorkflowIndex(stackIndex) {
        breadcrumbsStack = breadcrumbsStack.slice(0, stackIndex + 1);
        currentWorkflowId = breadcrumbsStack[breadcrumbsStack.length - 1];
        closeInspector();
        renderCurrentWorkflow();
      }

      function drillDownIntoSubworkflow(childWorkflowId) {
        if (!workflows[childWorkflowId]) {
          showToast('Child subworkflow "' + childWorkflowId + '" not bundled in export.');
          return;
        }
        breadcrumbsStack.push(childWorkflowId);
        currentWorkflowId = childWorkflowId;
        closeInspector();
        renderCurrentWorkflow();
      }

      function closeInspector() {
        const inspector = document.getElementById('inspector');
        if (inspector) inspector.classList.add('hidden');
        if (cy) cy.nodes().removeClass('selected-node');
        selectedNodeData = null;
      }

      function openInspector(nodeData) {
        if (!nodeData) return;
        selectedNodeData = nodeData;
        const inspector = document.getElementById('inspector');
        if (!inspector) return;
        inspector.classList.remove('hidden');

        const nameEl = document.getElementById('insp-name');
        if (nameEl) nameEl.textContent = nodeData.name || 'Unnamed Node';

        const typeBadge = document.getElementById('insp-type-badge');
        if (typeBadge) typeBadge.textContent = nodeData.type || 'step';

        const statusBadge = document.getElementById('insp-status-badge');
        if (statusBadge) {
          const st = nodeData.status || 'pending';
          statusBadge.textContent = (STATUS_ICONS[st] || '') + ' ' + st;
          statusBadge.className = 'badge badge-status-' + st;
        }

        const subagentBadge = document.getElementById('insp-subagent-badge');
        if (subagentBadge) {
          subagentBadge.style.display = nodeData.runInSubAgent ? 'inline-block' : 'none';
        }

        const promptEl = document.getElementById('insp-prompt');
        if (promptEl) {
          promptEl.textContent = nodeData.description || '(No prompt or description specified)';
        }

        const subActionWrap = document.getElementById('insp-subworkflow-action');
        if (subActionWrap) {
          if (nodeData.type === 'subworkflow' && nodeData.config?.childWorkflowId) {
            subActionWrap.style.display = 'block';
            const drillBtn = document.getElementById('insp-drilldown-btn');
            if (drillBtn) {
              drillBtn.onclick = () => drillDownIntoSubworkflow(nodeData.config.childWorkflowId);
            }
          } else {
            subActionWrap.style.display = 'none';
          }
        }

        const configWrap = document.getElementById('insp-config-details');
        if (configWrap) {
          configWrap.innerHTML = '';
          const cfg = nodeData.config || {};
          let hasConfig = false;

          if (nodeData.type === 'decision' && cfg.options) {
            hasConfig = true;
            const optDiv = document.createElement('div');
            const opts = Array.isArray(cfg.options) ? cfg.options.join(', ') : JSON.stringify(cfg.options);
            optDiv.innerHTML = '<strong>Decision Options:</strong> <code>' + escapeHtml(opts) + '</code>';
            configWrap.appendChild(optDiv);
          }

          if (nodeData.type === 'user_interaction') {
            hasConfig = true;
            if (cfg.prompt) {
              const p = document.createElement('div');
              p.innerHTML = '<strong>User Prompt:</strong> ' + escapeHtml(cfg.prompt);
              configWrap.appendChild(p);
            }
            if (cfg.options) {
              const optDiv = document.createElement('div');
              const opts = Array.isArray(cfg.options) ? cfg.options.join(', ') : JSON.stringify(cfg.options);
              optDiv.innerHTML = '<strong>Branch Options:</strong> <code>' + escapeHtml(opts) + '</code>';
              configWrap.appendChild(optDiv);
            }
          }

          if (cfg.maxIterations) {
            hasConfig = true;
            const iterDiv = document.createElement('div');
            iterDiv.innerHTML = '<strong>Max Loop Iterations:</strong> ' + cfg.maxIterations;
            configWrap.appendChild(iterDiv);
          }

          if (!hasConfig) {
            configWrap.innerHTML = '<span style="color: var(--text-muted);">None</span>';
          }
        }

        const iterCountEl = document.getElementById('insp-iter-count');
        if (iterCountEl) {
          iterCountEl.textContent = nodeData.iteration && nodeData.iteration > 1 ? '(Iteration ' + nodeData.iteration + ')' : '';
        }

        const errWrap = document.getElementById('insp-error-wrap');
        const errEl = document.getElementById('insp-error');
        if (errWrap && errEl) {
          if (nodeData.error) {
            errWrap.style.display = 'block';
            errEl.textContent = nodeData.error;
          } else {
            errWrap.style.display = 'none';
          }
        }

        const histWrap = document.getElementById('insp-history-wrap');
        const histList = document.getElementById('insp-history-list');
        if (histWrap && histList) {
          histList.innerHTML = '';
          if (Array.isArray(nodeData.iterationHistory) && nodeData.iterationHistory.length > 0) {
            histWrap.style.display = 'block';
            nodeData.iterationHistory.forEach(rec => {
              const div = document.createElement('div');
              div.style.cssText = 'border-left: 2px solid var(--accent); padding-left: 8px; margin-top: 4px;';
              const timeStr = rec.completedAt ? ' (' + rec.completedAt.slice(11, 19) + ')' : '';
              div.innerHTML = '<div style="font-size: 0.75rem; color: var(--accent); font-weight: 600;">Iteration ' + rec.iteration + timeStr + '</div>' +
                (rec.error ? '<div class="error-content" style="padding: 4px 6px; font-size: 0.72rem; margin-top: 2px;">' + escapeHtml(rec.error) + '</div>' : '');
              histList.appendChild(div);
            });
          } else {
            histWrap.style.display = 'none';
          }
        }

        const nodeIdEl = document.getElementById('insp-node-id');
        if (nodeIdEl) nodeIdEl.textContent = nodeData.id || '-';
        
        const wfIdEl = document.getElementById('insp-wf-id');
        if (wfIdEl) wfIdEl.textContent = nodeData.workflowId || '-';

        const updatedEl = document.getElementById('insp-updated-at');
        if (updatedEl) {
          updatedEl.textContent = nodeData.updatedAt ? new Date(nodeData.updatedAt).toLocaleString() : '-';
        }
      }

      function buildCytoscapeElements(wfData) {
        const elements = [];
        const nodes = wfData.nodes || [];
        const edges = wfData.edges || [];

        nodes.forEach(n => {
          const icon = STATUS_ICONS[n.status] || '⏳';
          const iterSuffix = n.iteration && n.iteration > 1 ? ' (i:' + n.iteration + ')' : '';
          const subBadge = n.type === 'subworkflow' ? ' 📦' : n.type === 'user_interaction' ? ' 👤' : '';
          const displayLabel = icon + ' ' + n.name + subBadge + iterSuffix;

          elements.push({
            group: 'nodes',
            grabbable: !nodesLocked,
            data: {
              id: n.id,
              label: displayLabel,
              nodeType: n.type,
              status: n.status,
              rawNode: n
            }
          });
        });

        edges.forEach(e => {
          elements.push({
            group: 'edges',
            data: {
              id: e.id,
              source: e.fromNodeId,
              target: e.toNodeId,
              label: e.condition || ''
            }
          });
        });

        return elements;
      }

      function renderCurrentWorkflow() {
        updateBreadcrumbBar();
        const wfData = workflows[currentWorkflowId];
        if (!wfData) return;

        const elements = buildCytoscapeElements(wfData);
        if (cy) {
          cy.destroy();
        }

        const container = document.getElementById('cy');
        if (!container) return;

        cy = cytoscape({
          container: container,
          elements: elements,
          boxSelectionEnabled: false,
          autoungrabify: nodesLocked,
          userPanningEnabled: true,
          userZoomingEnabled: true,
          style: [
            {
              selector: 'node',
              style: {
                'label': 'data(label)',
                'color': '#f8fafc',
                'font-size': '12px',
                'font-weight': '600',
                'text-valign': 'center',
                'text-halign': 'center',
                'text-wrap': 'ellipsis',
                'text-max-width': '160px',
                'background-color': '#1e293b',
                'border-width': 2.5,
                'border-color': function(ele) {
                  return STATUS_COLORS[ele.data('status')] || '#475569';
                },
                'width': 190,
                'height': 54,
                'shape': function(ele) {
                  return NODE_SHAPES[ele.data('nodeType')] || 'round-rectangle';
                },
                'shadow-blur': 12,
                'shadow-color': 'rgba(0, 0, 0, 0.4)',
                'shadow-opacity': 0.8
              }
            },
            {
              selector: 'node[nodeType = "subworkflow"]',
              style: {
                'border-style': 'dashed',
                'border-width': 3,
                'border-color': '#a855f7',
                'background-color': '#2e1065'
              }
            },
            {
              selector: 'node[nodeType = "user_interaction"]',
              style: {
                'border-color': '#14b8a6',
                'background-color': '#134e4a'
              }
            },
            {
              selector: 'node[nodeType = "decision"]',
              style: {
                'width': 130,
                'height': 120,
                'text-max-width': '100px',
                'background-color': '#2d2305'
              }
            },
            {
              selector: 'node.selected-node',
              style: {
                'border-color': '#38bdf8',
                'border-width': 4,
                'shadow-color': '#38bdf8',
                'shadow-blur': 20
              }
            },
            {
              selector: 'node.highlight-path',
              style: {
                'border-color': '#38bdf8'
              }
            },
            {
              selector: 'node.dimmed',
              style: {
                'opacity': 0.2
              }
            },
            {
              selector: 'edge',
              style: {
                'width': 2,
                'line-color': '#64748b',
                'target-arrow-color': '#64748b',
                'target-arrow-shape': 'triangle',
                'curve-style': 'bezier',
                'label': 'data(label)',
                'font-size': '11px',
                'color': '#38bdf8',
                'text-background-color': '#0f172a',
                'text-background-opacity': 0.85,
                'text-background-padding': '3px',
                'text-background-shape': 'roundrectangle',
                'text-rotation': 'autorotate'
              }
            },
            {
              selector: 'edge.highlight-path',
              style: {
                'line-color': '#38bdf8',
                'target-arrow-color': '#38bdf8',
                'width': 3
              }
            },
            {
              selector: 'edge.dimmed',
              style: {
                'opacity': 0.15
              }
            }
          ],
          layout: {
            name: 'dagre',
            rankDir: layoutDirection,
            nodeSep: 60,
            rankSep: 80,
            padding: 40
          }
        });

        function handleNodeSelect(node) {
          if (!node) return;
          cy.nodes().removeClass('selected-node');
          node.addClass('selected-node');
          const raw = node.data('rawNode');
          if (raw) openInspector(raw);
        }

        let lastTapTime = 0;
        let lastTapNodeId = null;

        cy.on('tap', 'node', function(evt) {
          const node = evt.target;
          const raw = node.data('rawNode');
          const now = Date.now();

          handleNodeSelect(node);

          if (raw && raw.type === 'subworkflow' && raw.config?.childWorkflowId) {
            if (lastTapNodeId === node.id() && (now - lastTapTime) < 350) {
              drillDownIntoSubworkflow(raw.config.childWorkflowId);
            }
          }
          lastTapTime = now;
          lastTapNodeId = node.id();
        });

        cy.on('tap', function(evt) {
          if (evt.target === cy) {
            closeInspector();
          }
        });

        cy.on('mouseover', 'node', function(evt) {
          const c = document.getElementById('cy');
          if (c) c.style.cursor = 'pointer';
          const node = evt.target;
          const connectedEdges = node.connectedEdges();
          const connectedNodes = connectedEdges.connectedNodes();
          cy.elements().addClass('dimmed');
          node.removeClass('dimmed').addClass('highlight-path');
          connectedNodes.removeClass('dimmed').addClass('highlight-path');
          connectedEdges.removeClass('dimmed').addClass('highlight-path');
          if (selectedNodeData) {
            cy.$id(selectedNodeData.id).removeClass('dimmed').addClass('selected-node');
          }
        });

        cy.on('mouseout', 'node', function() {
          const c = document.getElementById('cy');
          if (c) c.style.cursor = 'default';
          cy.elements().removeClass('dimmed highlight-path');
          if (selectedNodeData) {
            cy.$id(selectedNodeData.id).addClass('selected-node');
          }
        });
      }

      // Duration & Countdown Timer
      if (rawData.ticket?.expiresAt) {
        const timerEl = document.getElementById('ticket-timer');
        const updateTimer = () => {
          const remainingMs = rawData.ticket.expiresAt - Date.now();
          if (remainingMs <= 0) {
            if (timerEl) {
              timerEl.textContent = 'Expired';
              timerEl.style.color = '#ef4444';
            }
            return;
          }
          const totalSecs = Math.floor(remainingMs / 1000);
          const totalMins = Math.floor(totalSecs / 60);
          const totalHours = Math.floor(totalMins / 60);
          const totalDays = Math.floor(totalHours / 24);

          if (timerEl) {
            if (totalDays >= 2) {
              timerEl.textContent = totalDays + ' days left';
            } else if (totalDays === 1) {
              timerEl.textContent = '1 day, ' + (totalHours % 24) + 'h left';
            } else if (totalHours >= 1) {
              timerEl.textContent = totalHours + 'h ' + (totalMins % 60) + 'm left';
            } else {
              const m = totalMins;
              const s = totalSecs % 60;
              timerEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
            }
          }
        };
        updateTimer();
        setInterval(updateTimer, 1000);
      }

      // Event Listeners
      const fitBtn = document.getElementById('fit-btn');
      if (fitBtn) fitBtn.onclick = () => { if (cy) cy.fit(undefined, 40); };

      const zoomInBtn = document.getElementById('zoom-in-btn');
      if (zoomInBtn) zoomInBtn.onclick = () => { if (cy) cy.zoom(cy.zoom() * 1.25); };

      const zoomOutBtn = document.getElementById('zoom-out-btn');
      if (zoomOutBtn) zoomOutBtn.onclick = () => { if (cy) cy.zoom(cy.zoom() * 0.8); };

      const resetZoomBtn = document.getElementById('reset-zoom-btn');
      if (resetZoomBtn) resetZoomBtn.onclick = () => { if (cy) { cy.zoom(1); cy.center(); } };

      const lockToggleBtn = document.getElementById('lock-toggle-btn');
      if (lockToggleBtn) {
        lockToggleBtn.onclick = () => {
          nodesLocked = !nodesLocked;
          if (cy) {
            cy.autoungrabify(nodesLocked);
          }
          lockToggleBtn.textContent = nodesLocked ? '🔒 Locked' : '🔓 Drag';
          showToast(nodesLocked ? 'Node positions locked' : 'Free dragging enabled');
        };
      }

      const closeInspBtn = document.getElementById('close-inspector-btn');
      if (closeInspBtn) closeInspBtn.onclick = closeInspector;

      const copyPromptBtn = document.getElementById('copy-prompt-btn');
      if (copyPromptBtn) {
        copyPromptBtn.onclick = () => {
          if (selectedNodeData?.description) {
            navigator.clipboard.writeText(selectedNodeData.description).then(() => {
              showToast('Prompt copied to clipboard!');
            });
          }
        };
      }

      const layoutToggleBtn = document.getElementById('layout-toggle-btn');
      if (layoutToggleBtn) {
        layoutToggleBtn.onclick = () => {
          layoutDirection = layoutDirection === 'TB' ? 'LR' : 'TB';
          const label = document.getElementById('layout-dir-label');
          if (label) label.textContent = layoutDirection;
          if (cy) {
            cy.layout({
              name: 'dagre',
              rankDir: layoutDirection,
              nodeSep: 60,
              rankSep: 80,
              padding: 40
            }).run();
          }
        };
      }

      const statusFilter = document.getElementById('status-filter');
      if (statusFilter) {
        statusFilter.onchange = (e) => {
          const val = e.target.value;
          if (!cy) return;
          if (val === 'all') {
            cy.nodes().style('display', 'element');
            cy.edges().style('display', 'element');
          } else {
            cy.nodes().forEach(n => {
              n.style('display', n.data('status') === val ? 'element' : 'none');
            });
            cy.edges().forEach(e => {
              const show = e.source().style('display') === 'element' && e.target().style('display') === 'element';
              e.style('display', show ? 'element' : 'none');
            });
          }
        };
      }

      const nodeSearch = document.getElementById('node-search');
      if (nodeSearch) {
        nodeSearch.oninput = (e) => {
          const term = e.target.value.toLowerCase().trim();
          if (!cy) return;
          if (!term) {
            cy.nodes().removeClass('selected-node dimmed');
            return;
          }
          cy.nodes().forEach(n => {
            const raw = n.data('rawNode');
            const matchName = raw?.name?.toLowerCase().includes(term);
            const matchPrompt = (raw?.description || '').toLowerCase().includes(term);
            if (matchName || matchPrompt) {
              n.removeClass('dimmed').addClass('selected-node');
            } else {
              n.addClass('dimmed').removeClass('selected-node');
            }
          });
        };
      }

      const autoRefreshBtn = document.getElementById('auto-refresh-btn');
      if (autoRefreshBtn) {
        autoRefreshBtn.onclick = () => {
          autoRefreshActive = !autoRefreshActive;
          const label = document.getElementById('refresh-state-label');
          if (label) {
            label.textContent = autoRefreshActive ? 'ON' : 'OFF';
            label.style.color = autoRefreshActive ? '#6ee7b7' : '#94a3b8';
          }
          showToast(autoRefreshActive ? 'Live auto-refresh enabled' : 'Live auto-refresh paused');
        };
      }

      // Auto-refresh polling
      setInterval(async () => {
        if (!autoRefreshActive) return;
        try {
          const endpoint = '/api/visualize/' + currentWorkflowId + '/data' + window.location.search;
          const res = await fetch(endpoint);
          if (!res.ok) return;
          const fresh = await res.json();
          if (fresh.workflow) {
            workflows[currentWorkflowId] = fresh.workflow;
            fresh.workflow.nodes.forEach(n => {
              if (cy) {
                const nodeEl = cy.$id(n.id);
                if (nodeEl.length > 0) {
                  nodeEl.data('status', n.status);
                  nodeEl.data('rawNode', n);
                  const icon = STATUS_ICONS[n.status] || '⏳';
                  const iterSuffix = n.iteration && n.iteration > 1 ? ' (i:' + n.iteration + ')' : '';
                  const subBadge = n.type === 'subworkflow' ? ' 📦' : n.type === 'user_interaction' ? ' 👤' : '';
                  nodeEl.data('label', icon + ' ' + n.name + subBadge + iterSuffix);
                }
              }
            });
            if (selectedNodeData) {
              const updated = fresh.workflow.nodes.find(n => n.id === selectedNodeData.id);
              if (updated) openInspector(updated);
            }
          }
        } catch {
          // Ignore offline polling error
        }
      }, 2500);

      // Initial Render
      renderCurrentWorkflow();
    })();
  `;
}
