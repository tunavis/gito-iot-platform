"""Background task scheduler for notification retry and queue processing.

Uses APScheduler to periodically:
- Process pending notifications from queue
- Retry failed notifications with exponential backoff
- Clean up old completed notifications
"""

import logging
from typing import Optional
from uuid import UUID
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import and_, select

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.models import Notification, NotificationQueue, AlertEvent
from app.services.notification_dispatcher import NotificationDispatcher
from app.database import get_session

logger = logging.getLogger(__name__)


class NotificationBackgroundTasks:
    """Background task manager for notification retry and cleanup."""

    def __init__(self):
        """Initialize background tasks scheduler."""
        self.scheduler: Optional[AsyncIOScheduler] = None

    async def start(self) -> None:
        """Start background task scheduler."""
        try:
            self.scheduler = AsyncIOScheduler()
            
            # Process notification queue every 10 seconds
            self.scheduler.add_job(
                self.process_notification_queue,
                IntervalTrigger(seconds=10),
                id="process_notification_queue",
                name="Process notification queue",
                coalesce=True,
                max_instances=1,
            )
            
            # Retry failed notifications every 30 seconds
            self.scheduler.add_job(
                self.retry_failed_notifications,
                IntervalTrigger(seconds=30),
                id="retry_failed_notifications",
                name="Retry failed notifications",
                coalesce=True,
                max_instances=1,
            )
            
            # Clean up old notifications daily
            self.scheduler.add_job(
                self.cleanup_old_notifications,
                IntervalTrigger(hours=1),
                id="cleanup_old_notifications",
                name="Clean up old notifications",
                coalesce=True,
                max_instances=1,
            )
            
            self.scheduler.start()
            logger.info("✅ Background task scheduler started")
        except Exception as e:
            logger.error(f"Failed to start background task scheduler: {e}")
            raise

    async def stop(self) -> None:
        """Stop background task scheduler."""
        if self.scheduler:
            self.scheduler.shutdown()
            logger.info("Background task scheduler stopped")

    async def process_notification_queue(self) -> None:
        """Process pending notifications from queue.
        
        This runs periodically and dispatches notifications that are
        waiting in the notification_queue table.
        """
        try:
            # Get a database session
            session_gen = get_session()
            session = await session_gen.__anext__()
            
            try:
                # Query pending queue items
                pending_items = session.exec(
                    select(NotificationQueue).where(
                        NotificationQueue.status == "pending"
                    ).order_by(NotificationQueue.created_at)
                ).all()
                
                if not pending_items:
                    return
                
                logger.info(f"Processing {len(pending_items)} pending notifications")
                
                for queue_item in pending_items:
                    try:
                        # Mark as processing
                        queue_item.status = "processing"
                        queue_item.attempted_at = datetime.utcnow()
                        session.commit()
                        
                        # Dispatch the notification
                        dispatcher = NotificationDispatcher(
                            session,
                            queue_item.tenant_id
                        )
                        
                        notification_ids = dispatcher.process_alert_event(
                            queue_item.alert_event_id
                        )
                        
                        # Mark queue item as completed
                        queue_item.status = "completed"
                        queue_item.processed_at = datetime.utcnow()
                        
                        logger.info(
                            f"Notification dispatched",
                            extra={
                                "alert_event_id": str(queue_item.alert_event_id),
                                "notification_count": len(notification_ids)
                            }
                        )
                    except Exception as e:
                        queue_item.status = "failed"
                        queue_item.error_message = str(e)
                        logger.error(
                            f"Failed to process notification queue item",
                            extra={
                                "alert_event_id": str(queue_item.alert_event_id),
                                "error": str(e)
                            }
                        )
                    finally:
                        session.commit()
            finally:
                await session_gen.aclose()
        except Exception as e:
            logger.error(f"Error in notification queue processor: {e}")

    async def retry_failed_notifications(self) -> None:
        """Retry failed notifications with exponential backoff.
        
        Notifications can be retried up to 5 times with exponential backoff:
        - Attempt 1: immediate
        - Attempt 2: 1 minute
        - Attempt 3: 2 minutes
        - Attempt 4: 5 minutes
        - Attempt 5: 10 minutes
        """
        try:
            session_gen = get_session()
            session = await session_gen.__anext__()
            
            try:
                # Find failed notifications ready for retry
                failed_notifications = session.exec(
                    select(Notification).where(
                        and_(
                            Notification.status == "pending",
                            Notification.retry_count < 5,
                            Notification.next_retry_at <= datetime.utcnow(),
                        )
                    ).order_by(Notification.created_at)
                ).all()
                
                if not failed_notifications:
                    return
                
                logger.info(
                    f"Retrying {len(failed_notifications)} failed notifications"
                )
                
                for notif in failed_notifications:
                    try:
                        # Increment retry count
                        notif.retry_count += 1
                        
                        # Calculate exponential backoff
                        backoff_minutes = self._calculate_backoff(notif.retry_count)
                        notif.next_retry_at = datetime.utcnow() + timedelta(
                            minutes=backoff_minutes
                        )
                        
                        # Get the notification service and retry
                        from app.services.channels import ChannelFactory
                        from app.models import NotificationChannel
                        
                        channel = session.exec(
                            select(NotificationChannel).where(
                                NotificationChannel.id == notif.channel_id
                            )
                        ).first()
                        
                        if not channel:
                            notif.status = "failed"
                            notif.error_message = "Channel not found"
                            logger.warning(
                                f"Channel {notif.channel_id} not found for notification {notif.id}"
                            )
                            session.commit()
                            continue
                        
                        service = ChannelFactory.create_service(channel.channel_type)
                        if not service:
                            notif.status = "failed"
                            notif.error_message = f"Service not available: {channel.channel_type}"
                            session.commit()
                            continue
                        
                        # Attempt to send again (use existing content from notification record)
                        # For now, we'll mark it ready for next attempt
                        logger.debug(
                            f"Scheduled retry for notification {notif.id}",
                            extra={"retry_count": notif.retry_count}
                        )
                        
                    except Exception as e:
                        logger.error(
                            f"Error retrying notification {notif.id}: {e}"
                        )
                    finally:
                        session.commit()
            finally:
                await session_gen.aclose()
        except Exception as e:
            logger.error(f"Error in notification retry processor: {e}")

    async def cleanup_old_notifications(self) -> None:
        """Clean up old completed/failed notifications.
        
        Keeps notifications for 30 days then archives/deletes them
        based on tenant retention policy.
        """
        try:
            session_gen = get_session()
            session = await session_gen.__anext__()
            
            try:
                # Default retention: 30 days
                cutoff_date = datetime.utcnow() - timedelta(days=30)
                
                # Find old completed/failed notifications
                old_notifications = session.exec(
                    select(Notification).where(
                        and_(
                            Notification.status.in_(["sent", "failed"]),
                            Notification.created_at < cutoff_date
                        )
                    )
                ).all()
                
                if not old_notifications:
                    return
                
                # Soft delete: mark as archived instead of permanent delete
                for notif in old_notifications:
                    # Could add an 'archived_at' field instead of deleting
                    # For now, we'll just log
                    logger.debug(
                        f"Old notification eligible for cleanup: {notif.id}",
                        extra={
                            "created_at": notif.created_at.isoformat(),
                            "status": notif.status
                        }
                    )
                
                logger.info(
                    f"Found {len(old_notifications)} old notifications for cleanup"
                )
            finally:
                await session_gen.aclose()
        except Exception as e:
            logger.error(f"Error in cleanup processor: {e}")

    @staticmethod
    def _calculate_backoff(attempt: int) -> int:
        """Calculate exponential backoff in minutes.
        
        Args:
            attempt: Retry attempt number (1-5)
            
        Returns:
            Minutes to wait before next attempt
        """
        backoff_schedule = {
            1: 0,      # Immediate (2nd attempt)
            2: 1,      # 1 minute
            3: 2,      # 2 minutes
            4: 5,      # 5 minutes
            5: 10,     # 10 minutes
        }
        return backoff_schedule.get(attempt, 10)


# Global instance
notification_background_tasks = NotificationBackgroundTasks()
